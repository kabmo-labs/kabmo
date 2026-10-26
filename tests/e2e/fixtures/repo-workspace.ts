/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A workspace that IS a git repository, with one commit.
 *
 * `seedWorkspace` binds a folder to a bare temp directory, which is what most
 * specs want and is deliberately not what this one needs: the whole feature
 * starts with `git worktree add`, so the folder has to be a repository with a
 * HEAD. Written through the REAL folder route like every other fixture, so the
 * stored `project_path` is the one the server resolved rather than the one this
 * file built.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HarnessServer } from './server';
import { removeDirWhenFree } from './remove-dir';
import { makeTempDir } from './temp-root';

export interface SeededRepoWorkspace {
  id: number;
  /** The directory as the SERVER resolved it — every scope check uses this. */
  path: string;
  dispose(): void;
}

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

export async function seedRepoWorkspace(
  server: HarnessServer,
  name = 'e2e-worktree',
): Promise<SeededRepoWorkspace> {
  const dir = makeTempDir('repo-');
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'README.md'), `# ${name}\n`);
  // An ignored build folder, so the carry-over has something real to copy —
  // the reason the carry exists is that a fresh worktree cannot run without it.
  writeFileSync(join(dir, '.gitignore'), 'node_modules\n');
  mkdirSync(join(dir, 'node_modules', 'dep'), { recursive: true });
  writeFileSync(join(dir, 'node_modules', 'dep', 'index.js'), 'module.exports = {};\n');
  git(dir, 'add', 'README.md', '.gitignore');
  git(
    dir,
    '-c', 'user.email=e2e@example.invalid',
    '-c', 'user.name=E2E',
    'commit', '-q', '-m', 'seed',
  );

  const response = await fetch(`${server.baseURL}/api/folders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, path: dir }),
  });
  if (!response.ok) {
    throw new Error(`seedRepoWorkspace failed: ${response.status} ${await response.text()}`);
  }
  const payload = (await response.json()) as { id?: unknown; folder?: { id?: unknown; project_path?: unknown } };
  const id = Number(payload.id ?? payload.folder?.id);
  const path = String(payload.folder?.project_path ?? dir);
  if (!Number.isFinite(id)) {
    throw new Error(`seedRepoWorkspace: no id in response ${JSON.stringify(payload)}`);
  }

  return {
    id,
    path,
    dispose() {
      removeDirWhenFree(dir);
      // The worktrees live under the server's data directory, which the harness
      // owns and removes; nothing here has to reach them.
    },
  };
}