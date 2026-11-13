/**
 * @license
 * SPDX-License-Identifier: MIT
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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export interface CaptureServer {
  baseURL: string;
  stop: () => Promise<void>;
}

/**
 * A small git project the captures browse.
 *
 * Without one, every workspace panel falls back to the app root: the Files tree
 * lists the checkout, and Source Control lists the developer's own uncommitted
 * changes — in a published screenshot. The project lives under the capture's
 * temp root, so it is removed with the server, and it carries one modified and
 * one untracked file so the change list is not empty.
 */
function createDemoProject(root: string): string {
  const dir = join(root, 'demo-project');
  mkdirSync(join(dir, 'src/lib'), { recursive: true });
  mkdirSync(join(dir, 'docs'), { recursive: true });

  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({
    name: 'demo-project',
    private: true,
    type: 'module',
    scripts: { test: 'bun test', dev: 'bun run src/index.ts' },
  }, null, 2)}\n`);
  writeFileSync(join(dir, 'README.md'), '# Demo project\n\nA small checkout the Kabmo captures browse.\n');
  writeFileSync(join(dir, '.gitignore'), 'node_modules\ndist\n');
  writeFileSync(join(dir, 'src/index.ts'), "import { formatDuration } from './lib/format';\n\nconsole.log(formatDuration(4200));\n");
  writeFileSync(join(dir, 'src/lib/format.ts'), 'export function formatDuration(ms: number): string {\n  return `${Math.round(ms / 1000)}s`;\n}\n');
  writeFileSync(join(dir, 'docs/notes.md'), '# Notes\n\n- Keep the parser pure.\n- One module per concern.\n');

  const git = (...args: string[]): void => {
    const result = Bun.spawnSync(['git', ...args], { cwd: dir, stdout: 'ignore', stderr: 'pipe' });
    if (result.exitCode !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString()}`);
    }
  };
  git('init', '-q');
  git('config', 'user.email', 'demo@kabmo.dev');
  git('config', 'user.name', 'Kabmo Demo');
  git('add', '.');
  git('commit', '-q', '-m', 'Initial commit');

  // One modified and one untracked file: the Source Control panel needs a
  // change list, and a clean tree would photograph as an empty panel.
  writeFileSync(join(dir, 'src/lib/format.ts'), 'export function formatDuration(ms: number): string {\n  const seconds = ms / 1000;\n  return seconds < 1 ? `${ms}ms` : `${seconds.toFixed(1)}s`;\n}\n');
  writeFileSync(join(dir, 'src/lib/parse.ts'), "export function parseDuration(value: string): number {\n  const match = /^(\\d+(?:\\.\\d+)?)(ms|s)$/.exec(value);\n  if (!match) throw new Error(`invalid duration: ${value}`);\n  return Number(match[1]) * (match[2] === 's' ? 1000 : 1);\n}\n");

  return dir;
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

  // Bind the seed's first folder to the demo project, so the workspace panels
  // read it instead of the checkout. Folder 1 is the seed's `kabmo` group
  // (`server/lib/db/seed.ts`), and session 1 — the capture's session — is in it.
  const demoProject = createDemoProject(root);
  const bound = await fetch(`${baseURL}/api/folders/1/settings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectPath: demoProject }),
  });
  if (!bound.ok) throw new Error(`could not bind the demo project: ${bound.status} ${await bound.text()}`);

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
