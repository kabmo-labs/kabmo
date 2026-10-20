/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The isolated MOCK server a README capture runs against.
 *
 * Split out of `readme-media.ts` so that script stays about what to capture.
 * The isolation is the whole point of this module: a capture server must never
 * be able to read a developer's real sessions, and every path it writes is
 * redirected under one temp root that is removed when it stops.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export interface CaptureServer {
  baseURL: string;
  stop: () => Promise<void>;
}

/** A port the OS just handed back, so a stray capture server cannot collide. */
async function pickPort(): Promise<number> {
  const probe = Bun.serve({ port: 0, fetch: () => new Response('') });
  const port = probe.port!;
  await probe.stop(true);
  return port;
}

/** Kill the whole tree: the server spawns `omp` children and a PTY host. */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

/** Poll the health route until the server answers, or fail with its own log. */
async function waitForReady(child: ChildProcess, baseURL: string, log: () => string): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`capture server exited early:\n${log()}`);
    try {
      const response = await fetch(`${baseURL}/api/health`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) throw new Error(`capture server never became ready:\n${log()}`);
    await new Promise((done) => setTimeout(done, 150));
  }
}

/**
 * Start one `MOCK=true` server, the same shape the e2e harness boots.
 *
 * `repoRoot` is the checkout, because the server resolves its app root, its fs
 * browse root and the bundled marketplace from the working directory.
 */
export async function startCaptureServer(repoRoot: string): Promise<CaptureServer> {
  const root = mkdtempSync(join(tmpdir(), 'kabmo-readme-'));
  const dataDir = join(root, 'data');
  const agentDir = join(root, 'agent');
  const marketplaceDir = join(root, 'marketplace');
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(marketplaceDir, { recursive: true });

  const port = await pickPort();
  const child = spawn('bun', ['run', 'src/server/index.ts', '--kabmo-server'], {
    cwd: repoRoot,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      NODE_ENV: 'development',
      MOCK: 'true',
      KABMO_DATA_DIR: dataDir,
      KABMO_DB_PATH: join(dataDir, 'db.sqlite'),
      PI_CODING_AGENT_DIR: agentDir,
      KABMO_MARKETPLACE_DIR: marketplaceDir,
      KABMO_BUNDLED_MARKETPLACE_DIR: resolve(repoRoot, 'marketplace'),
      SYNC_WORKSPACE: 'false',
    },
  });

  let log = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    log += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    log += chunk.toString();
  });

  const baseURL = `http://127.0.0.1:${port}`;
  await waitForReady(child, baseURL, () => log);

  return {
    baseURL,
    async stop() {
      killTree(child);
      const gone = Date.now() + 5_000;
      while (child.exitCode === null && Date.now() < gone) await new Promise((done) => setTimeout(done, 100));
      if (child.exitCode === null) {
        try {
          process.kill(-child.pid!, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      }
      rmSync(root, { recursive: true, force: true });
    },
  };
}
