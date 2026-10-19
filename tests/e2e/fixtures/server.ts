/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Boots a REAL Kabmo server for browser specs, isolated to a temp root.
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
 * root that teardown removes. A spec that leaked into `~/.kabmo` or the
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

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { removeDirWhenFree } from './remove-dir';
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
  /**
   * Register a directory to delete AFTER this server has stopped.
   *
   * A workspace a spec seeds is scanned by the server, so its handles can
   * outlive the spec body. Deleting it in the spec's own `dispose()` loses the
   * race on Windows (`EBUSY … rmdir`) — measured as 19 failing specs. Queuing it
   * here moves the delete after the process is gone, which is the only point at
   * which the OS is guaranteed to have released them.
   */
  removeAfterStop(dir: string): void;
  /** Boot output so far, for a failing spec's report. */
  log(): string;
  stop(): Promise<void>;
}

/**
 * A REAL executable that runs `fake-omp.ts`, compiled once per run.
 *
 * It used to be a `#!/bin/sh\nexec bun …` script chmod-ed `0o755`, which is
 * exactly the shape Windows cannot start. Measured in libuv's
 * `src/win/process.c` (`search_path` → `path_search_walk_ext`), the Windows
 * spawn resolves ONLY `.com` and `.exe` — "Since CreateProcess can start only
 * .com and .exe files, only those extensions are tried" — so neither a shell
 * script nor a `.cmd` can be spawned by `Bun.spawn`, whatever its mode bits
 * say. A compiled binary sidesteps the question entirely and is also the more
 * faithful fixture: a real `omp` is a real executable.
 *
 * Compiled ONCE per process and cached: it is ~70 MB, every spec boots its own
 * server, and the source cannot change under a running suite. The directory is
 * removed on process exit, because a suite that leaves 70 MB in the temp dir
 * per run is a leak that only shows up as a full disk.
 *
 * `--compile` carries the Bun runtime, so the result needs no `bun` on the
 * child's PATH — which matters for the server under test, not for this caller.
 */
let fakeOmpBinary: Promise<string> | undefined;

function compiledFakeOmp(): Promise<string> {
  fakeOmpBinary ??= (() => {
    const dir = mkdtempSync(join(tmpdir(), 'omc-e2e-omp-'));
    // `.exe` on Windows: the extension is what makes it startable there.
    const outfile = join(dir, process.platform === 'win32' ? 'fake-omp.exe' : 'fake-omp');
    process.once('exit', () => {
      try {
        removeDirWhenFree(dir);
      } catch {
        // Best effort: the OS reclaims the temp dir regardless.
      }
    });
    const result = spawnSync('bun', ['build', FAKE_OMP, '--compile', '--outfile', outfile], { stdio: 'pipe' });
    if (result.status !== 0) {
      throw new Error(`could not compile the fake omp:\n${result.stderr?.toString() ?? ''}`);
    }
    return Promise.resolve(outfile);
  })();
  return fakeOmpBinary;
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

/**
 * End the server and everything it started.
 *
 * POSIX signals the process GROUP: the server is spawned detached, so its
 * grandchildren (a PTY shell, an omp child) die with it. Windows has no
 * negative-pid equivalent — `process.kill(-pid)` is not a thing there — so it
 * uses `taskkill /t`, the same mechanism Kabmo's own
 * `killProcessTree` takes. Falling back to the direct child alone would leave
 * a detached `omp` behind on every Windows spec.
 */
function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (typeof child.pid !== 'number') return;
  if (process.platform === 'win32') {
    const args = ['/pid', String(child.pid), '/t'];
    if (signal === 'SIGKILL') args.push('/f');
    try {
      spawnSync('taskkill', args, { stdio: 'ignore', windowsHide: true });
    } catch {
      // taskkill missing: the direct child is the only reachable target.
      child.kill(signal);
    }
    return;
  }
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
  // defaults to `~/.kabmo/marketplace` — NOT under the data directory. A
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

  // Real mode drives the scripted child. `KABMO_OMP_BIN` must be an
  // EXECUTABLE path — the server spawns it directly — so it is a compiled
  // binary, not a shell script (see `compiledFakeOmp` for why a `#!/bin/sh`
  // shim cannot work on Windows).
  const ompBin = options.mode === 'real' ? await compiledFakeOmp() : undefined;

  const child = spawn('bun', ['run', 'src/server/index.ts', '--kabmo-server'], {
    cwd: options.repoRoot,
    // Windows has no process groups; the server is killed through `taskkill /t`
    // instead (see `signalGroup`), so detaching would only create a console.
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      NODE_ENV: 'development',
      // The three paths that decide where the server writes. `MOCK` chooses the
      // data mode; `KABMO_OMP_BIN` is only meaningful in real mode.
      MOCK: options.mode === 'mock' ? 'true' : 'false',
      KABMO_DATA_DIR: dataDir,
      KABMO_DB_PATH: join(dataDir, 'db.sqlite'),
      PI_CODING_AGENT_DIR: agentDir,
      // Both plugin-marketplace roots, or a spec's install lands in the real
      // `~/.kabmo/marketplace` and the bundled store is the checkout's own.
      KABMO_MARKETPLACE_DIR: marketplaceDir,
      KABMO_BUNDLED_MARKETPLACE_DIR: bundledDir,
      ...(ompBin ? { KABMO_OMP_BIN: ompBin } : {}),
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
  /** Directories a spec asked to delete, swept after the server exits. */
  const pendingRemovals: string[] = [];
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
    removeAfterStop(dir) {
      pendingRemovals.push(dir);
    },
    async stop() {
      if (alive) {
        signalGroup(child, 'SIGTERM');
        const stopped = await Promise.race([exited.then(() => true), sleep(STOP_GRACE_MS).then(() => false)]);
        if (!stopped) {
          signalGroup(child, 'SIGKILL');
          await exited;
        }
      }
      // After the process is gone: a workspace the server scanned is only
      // deletable once IT has released the handles.
      for (const dir of pendingRemovals.splice(0)) removeDirWhenFree(dir);
      removeDirWhenFree(runRoot);
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
