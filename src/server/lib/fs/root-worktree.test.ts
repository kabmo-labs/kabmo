/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The WORKTREE branch of the scoped-root allow-list.
 *
 * A chat started in a linked checkout runs THERE, outside its folder's
 * `project_path` — and `resolveRoot` answered the fallback for it (measured), so
 * Files/Search/Git/Terminal silently showed the app root while the agent wrote
 * to the worktree.
 *
 * The rule is deliberately narrow: the candidate's own REPOSITORY ROOT must be a
 * registered project, so a registered project never becomes a filesystem grant.
 * A SUBDIRECTORY of a registered checkout stays refused — the allow-list is exact
 * roots, and a panel is pointed at a worktree root, never at a folder inside it.
 *
 * Its own file, with its own database, because it needs a REAL git repository:
 * `resolveProjectRoot` only answers for a directory holding a `.git` entry, and
 * faking that would test the fake.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveRoot } from '@/server/lib/fs/root';
import { getDb } from '@/server/db.server';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { removeDir } from '@/test-support/remove-dir';

const GIT_ENV = { ...Bun.env, GIT_EDITOR: 'true', GIT_TERMINAL_PROMPT: '0' };

function git(cwd: string, ...args: string[]): string {
  return Bun.spawnSync({ cmd: ['git', ...args], cwd, env: GIT_ENV }).stdout.toString();
}

function makeRepo(dir: string): string {
  mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main', '.');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'user.name', 'Test');
  writeFileSync(join(dir, 'f.txt'), 'a\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

let workRoot: string;
const saved = { SYNC_WORKSPACE: Bun.env.SYNC_WORKSPACE, MOCK: Bun.env.MOCK };

beforeEach(async () => {
  await isolateDb();
  Bun.env.SYNC_WORKSPACE = 'false';
  Bun.env.MOCK = 'false';
  workRoot = mkdtempSync(join(tmpdir(), 'kabmo-root-worktree-'));
});

afterEach(async () => {
  await releaseDb();
  removeDir(workRoot);
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete Bun.env[key];
    else Bun.env[key] = value;
  }
});

describe('resolveRoot and worktrees', () => {
  test('a linked worktree of a registered project is allowed', async () => {
    const repo = makeRepo(join(workRoot, 'repo'));
    const linked = join(workRoot, 'linked-wt');
    git(repo, 'worktree', 'add', '-q', '-b', 'feat', linked);

    const db = await getDb();
    await db.run('INSERT INTO workspace_folders (name, project_path) VALUES (?, ?)', ['proj', repo]);

    expect(await resolveRoot(linked, '/fallback')).toBe(linked);
  });

  test('a SUBDIRECTORY of a registered checkout is still refused', async () => {
    const repo = makeRepo(join(workRoot, 'repo-sub'));
    const sub = join(repo, 'src');
    mkdirSync(sub, { recursive: true });

    const db = await getDb();
    await db.run('INSERT INTO workspace_folders (name, project_path) VALUES (?, ?)', ['proj', repo]);

    // The allow-list is EXACT roots. Panels point at a worktree root, which is
    // what the new branch admits; widening it to subdirectories would turn a
    // registered project into a filesystem grant for anything beneath it.
    expect(await resolveRoot(sub, '/fallback')).toBe('/fallback');
  });

  test('a worktree of an UNREGISTERED repository is refused', async () => {
    const registered = makeRepo(join(workRoot, 'registered'));
    const stranger = makeRepo(join(workRoot, 'stranger'));
    const strangerWt = join(workRoot, 'stranger-wt');
    git(stranger, 'worktree', 'add', '-q', '-b', 's', strangerWt);

    const db = await getDb();
    await db.run('INSERT INTO workspace_folders (name, project_path) VALUES (?, ?)', ['proj', registered]);

    expect(await resolveRoot(strangerWt, '/fallback')).toBe('/fallback');
    expect(await resolveRoot(stranger, '/fallback')).toBe('/fallback');
  });

  test('an exact registered project path is still honored, and a missing one falls back', async () => {
    const repo = makeRepo(join(workRoot, 'exact'));
    const db = await getDb();
    await db.run('INSERT INTO workspace_folders (name, project_path) VALUES (?, ?)', ['proj', repo]);

    expect(await resolveRoot(repo, '/fallback')).toBe(repo);
    expect(await resolveRoot(join(workRoot, 'gone'), '/fallback')).toBe('/fallback');
  });
});
