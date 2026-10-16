/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Boots a REAL chamber server for browser specs, isolated to a temp root.
 *
 * A subprocess, not an in-process Elysia app: the bugs a browser spec is here
 * to catch live in the assembled thing — the SSR shell, the client bundle, the
 * dev-asset proxy, the realtime socket, a spawned `omp` child — and none of
 * them exist in a test that mounts routes directly. The unit layer already
 * covers handlers in-process; this layer covers the product.
 *
 * Isolation is the whole contract, and it is why `getDatabasePath` had to be
 * fixed first: every path the server writes — the SQLite file, the instance
 * record, the agent tree it scans for sessions — is redirected under one temp
 * root that teardown removes. A spec that leaked into `~/.ompchamber` or the
 * checkout's `workspace.db` would corrupt the developer's machine.
 *
 * Readiness is polled on `GET /api/health` rather than parsed from the boot
 * log: the route is a first-class surface with a stable shape (`ok`, `port`),
 * and a log line is prose a future edit is free to reword. The port is
 * compared too, so a server that bound something else — a stale instance, a
 * lost port race — fails loudly instead of being adopted.
 *
 * Everything here uses `node:` APIs and `globalThis.fetch`, never `Bun.*`:
 * this module runs in a Playwright WORKER (Node), not in the Bun process the
 * app runs in, so a `Bun.spawn` here is a ReferenceError.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** This file's directory, so the fake `omp` is found relative to it. */
const FIXTURES_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_OMP = resolve(FIXTURES_DIR, 'fake-omp.ts');

/** Which data mode a server runs in. `mock` needs no `omp` install. */
export type HarnessMode = 'mock' | 'real';

export interface HarnessServer {
  mode: HarnessMode;
  baseURL: string;
  port: number;
  /** The temp root this server owns; removed by `stop`. */
  runRoot: string;
  /** Boot output so far, for a failing spec's report. */
  log(): string;
  stop(): Promise<void>;
}

/** A port the OS just handed back, so two servers cannot collide. */
function pickFreePort(): Promise<number> {
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const address = probe.address();
    if (!address || typeof address === 'string') {
      probe.close();
      reject(new Error('free-port probe returned no address'));
      return;
    }
    probe.close(() => resolve(address.port));
  });
  return promise;
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

const READY_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 150;
const STOP_GRACE_MS = 3_000;

async function waitForHealth(port: number, log: () => string, isAlive: () => boolean): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  const url = `http://127.0.0.1:${port}/api/health`;
  for (;;) {
    if (!isAlive()) throw new Error(`harness server exited before it became ready:\n${log()}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) {
        const payload = (await response.json()) as { ok?: unknown; port?: unknown };
        if (payload.ok === true && payload.port === port) return;
      }
    } catch {
      // Not listening yet, or mid-boot; the deadline decides.
    }
    if (Date.now() >= deadline) {
      throw new Error(`harness server not ready within ${READY_TIMEOUT_MS}ms:\n${log()}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

/** Signal the whole process group, falling back to the direct child. */
function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (typeof child.pid !== 'number') return;
  try {
    // Negative pid targets the group; the server is spawned detached so its
    // grandchildren (a PTY shell, an omp child) die with it.
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

/**
 * Start one server. `repoRoot` is the repository root on purpose — the server
 * resolves its app root, its fs browse root and the `extensions/` entry from
 * the working directory, exactly as `bun run dev` does.
 */
export async function startHarnessServer(options: {
  mode: HarnessMode;
  repoRoot: string;
  /** Extra env, for a spec that needs to point the fake `omp` somewhere. */
  env?: Record<string, string>;
}): Promise<HarnessServer> {
  const runRoot = mkdtempSync(join(tmpdir(), 'omc-e2e-'));
  const dataDir = join(runRoot, 'data');
  const agentDir = join(runRoot, 'agent');
  // The panel-plugin marketplace is a SECOND root the server writes, and it
  // defaults to `~/.ompchamber/marketplace` — NOT under the data directory. A
  // spec that installed a plugin therefore installed it into the developer's own
  // marketplace: measured, running this suite left an `e2e-plugin` row in the
  // real `marketplace.json` pointing at a temp repository that had been deleted.
  const marketplaceDir = join(runRoot, 'marketplace');
  // The BUNDLED store stays the checkout's own: it is the read-only list of what
  // the package offers (an offer, not an install), and a spec that installs a
  // bundled plugin must find the real one there. Pointing this at an empty temp
  // directory made every bundled install fail with "No bundled plugin with id
  // …" — the store was empty by construction.
  const bundledDir = join(options.repoRoot, 'marketplace');
  const port = await pickFreePort();

  // Real mode drives the scripted child. `OMPCHAMBER_OMP_BIN` must be an
  // EXECUTABLE path (the server spawns it directly), so a shim is written that
  // execs the TypeScript source under Bun — `fake-omp.ts` is not chmod-able as
  // itself, and the shebang is not enough on a machine where the file's mode
  // did not survive a checkout.
  let ompBin: string | undefined;
  if (options.mode === 'real') {
    ompBin = join(runRoot, 'fake-omp');
    writeFileSync(ompBin, `#!/bin/sh\nexec bun ${JSON.stringify(FAKE_OMP)} "$@"\n`, { mode: 0o755 });
    chmodSync(ompBin, 0o755);
  }

  const child = spawn('bun', ['run', 'src/server/index.ts', '--ompchamber-server'], {
    cwd: options.repoRoot,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      NODE_ENV: 'development',
      // The three paths that decide where the server writes. `MOCK` chooses the
      // data mode; `OMPCHAMBER_OMP_BIN` is only meaningful in real mode.
      MOCK: options.mode === 'mock' ? 'true' : 'false',
      OMPCHAMBER_DATA_DIR: dataDir,
      OMPCHAMBER_DB_PATH: join(dataDir, 'db.sqlite'),
      PI_CODING_AGENT_DIR: agentDir,
      // Both plugin-marketplace roots, or a spec's install lands in the real
      // `~/.ompchamber/marketplace` and the bundled store is the checkout's own.
      OMPCHAMBER_MARKETPLACE_DIR: marketplaceDir,
      OMPCHAMBER_BUNDLED_MARKETPLACE_DIR: bundledDir,
      ...(ompBin ? { OMPCHAMBER_OMP_BIN: ompBin } : {}),
      // Never inherit a developer's sync/credential choices.
      SYNC_WORKSPACE: 'false',
      ...options.env,
    },
  });

  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });

  let alive = true;
  const exitGate = Promise.withResolvers<void>();
  const exited = exitGate.promise;
  child.once('exit', () => {
    alive = false;
    exitGate.resolve();
  });

  const handle: HarnessServer = {
    mode: options.mode,
    baseURL: `http://127.0.0.1:${port}`,
    port,
    runRoot,
    log: () => output,
    async stop() {
      if (alive) {
        signalGroup(child, 'SIGTERM');
        const stopped = await Promise.race([exited.then(() => true), sleep(STOP_GRACE_MS).then(() => false)]);
        if (!stopped) {
          signalGroup(child, 'SIGKILL');
          await exited;
        }
      }
      rmSync(runRoot, { recursive: true, force: true });
    },
  };

  try {
    await waitForHealth(port, handle.log, () => alive);
  } catch (error) {
    await handle.stop();
    throw error;
  }
  return handle;
}
