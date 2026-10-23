/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Removing a worktree, against real repositories.
 *
 * Three rules, each measured, each a way work is lost if it is wrong:
 *
 *  - **Sessions are stopped BEFORE the directory goes.** The omp child holds the
 *    worktree as its cwd; a child in a deleted directory makes
 *    `resolveSpawnCwd` quietly run that session in the server's own folder.
 *  - **A dirty worktree refuses.** git exits 128 with "contains modified or
 *    untracked files" and `--force` is never passed, so the refusal is
 *    recoverable and the count is reported.
 *  - **The branch is deleted with `-d` only.** Its refusal (an unmerged branch)
 *    IS the safety net, so a branch with commits of its own survives and the
 *    answer says so rather than pretending the delete worked.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonicalPath } from '@/server/lib/fs/canonical';
import { createWorktree } from '@/server/lib/fs/worktree/create';
import type { CreateWorktreeDeps } from '@/server/lib/fs/worktree/create';
import { listWorktrees } from '@/server/lib/fs/worktree/list';
import { commitsAheadOf, dirtyCount, removeWorktree, type RemoveWorktreeDeps } from '@/server/lib/fs/worktree/remove';
import { invalidateWorktreeTopology } from '@/server/lib/fs/worktree/topology';
import { removeDir } from '@/test-support/remove-dir';

const FIXTURE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-worktree-remove-'));
const DATA_DIR = path.join(FIXTURE_ROOT, 'data');
const MANAGED_ROOT = path.join(DATA_DIR, 'worktrees');

const GIT_ENV_FOR_TESTS = {
  ...Bun.env,
  GIT_EDITOR: 'true',
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
};

function git(cwd: string, ...args: string[]): string {
  return Bun.spawnSync({ cmd: ['git', ...args], cwd, env: GIT_ENV_FOR_TESTS }).stdout.toString();
}

function makeRepo(name: string): string {
  const dir = path.join(FIXTURE_ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main', '.');
  fs.writeFileSync(path.join(dir, 'readme.md'), 'hello\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

/** The registry stub: the production one is two SQLite statements. */
function registry(rows = new Map<string, { start_ref: string }>()): RemoveWorktreeDeps & {
  rows: Map<string, { start_ref: string }>;
} {
  return {
    rows,
    rowFor: async (candidate) => rows.get(candidate),
    removeRow: async (candidate) => {
      rows.delete(candidate);
    },
  };
}

const createDeps = (rows = new Map<string, { startRef: string; projectId: string }>()): CreateWorktreeDeps => ({
  identityFor: async () => null,
  carryIgnored: false,
  dataDir: DATA_DIR,
  configuredDirectory: null,
  record: async (row) => {
    rows.set(await canonicalPath(row.path), { startRef: row.startRef, projectId: row.projectId });
  },
});

afterAll(async () => {
  await invalidateWorktreeTopology();
  removeDir(FIXTURE_ROOT);
});

describe('removeWorktree', () => {
  test('a dirty worktree refuses with the count and keeps everything', async () => {
    const repo = makeRepo('remove-dirty');
    const created = await createWorktree({ projectPath: repo, mode: 'new', branch: 'wt/dirty' }, createDeps());
    fs.writeFileSync(path.join(created.path, 'readme.md'), 'changed\n');
    fs.writeFileSync(path.join(created.path, 'untracked.txt'), 'new\n');

    const failure = removeWorktree(
      { projectPath: repo, worktreePath: created.path, managedRoot: MANAGED_ROOT },
      registry(),
    );
    await failure.catch((error) => expect(error).toMatchObject({ code: 'dirty', count: 2 }));

    expect(fs.existsSync(created.path)).toBe(true);
    expect((await listWorktrees(repo)).some((entry) => entry.path === created.path)).toBe(true);
    // The refusal names what it found, so the dialog can show it.
    expect(await dirtyCount(created.path)).toBe(2);
  });

  test('a clean worktree goes, and a branch with commits of its own is kept', async () => {
    const repo = makeRepo('remove-keep-branch');
    const records = new Map<string, { startRef: string; projectId: string }>();
    const created = await createWorktree(
      { projectPath: repo, mode: 'new', branch: 'wt/keepme' },
      createDeps(records),
    );
    fs.writeFileSync(path.join(created.path, 'work.txt'), 'done\n');
    git(created.path, 'add', '-A');
    git(created.path, 'commit', '-q', '-m', 'work');

    const rows = new Map([[await canonicalPath(created.path), { start_ref: 'HEAD' }]]);
    const deps = registry(rows);
    // The dialog gates on this number: anything above zero must disable the
    // branch checkbox, because `git branch -d` would refuse anyway.
    expect(await commitsAheadOf(await canonicalPath(repo), 'HEAD', 'wt/keepme')).toBe(1);

    const result = await removeWorktree(
      { projectPath: repo, worktreePath: created.path, deleteBranch: true, managedRoot: MANAGED_ROOT },
      deps,
    );

    expect(result.removed).toBe(true);
    expect(result.branchDeleted).toBe(false);
    expect(result.branchKept).toBe(true);
    expect(fs.existsSync(created.path)).toBe(false);
    expect(git(repo, 'branch', '--list', 'wt/keepme').trim()).toContain('wt/keepme');
    expect(rows.size).toBe(0);
  });

  test('a branch with nothing of its own is deleted with -d', async () => {
    const repo = makeRepo('remove-delete-branch');
    const created = await createWorktree({ projectPath: repo, mode: 'new', branch: 'wt/disposable' }, createDeps());
    const rows = new Map([[await canonicalPath(created.path), { start_ref: 'HEAD' }]]);

    const result = await removeWorktree(
      { projectPath: repo, worktreePath: created.path, deleteBranch: true, managedRoot: MANAGED_ROOT },
      registry(rows),
    );

    expect(result.branchDeleted).toBe(true);
    expect(git(repo, 'branch', '--list', 'wt/disposable').trim()).toBe('');
    expect(rows.size).toBe(0);
  });

  test('the main checkout cannot be removed', async () => {
    const repo = makeRepo('remove-primary');
    const primary = (await listWorktrees(repo)).find((entry) => entry.isPrimary)?.path as string;
    const failure = removeWorktree({ projectPath: repo, worktreePath: primary }, registry());
    await failure.catch((error) => expect(error).toMatchObject({ code: 'primary_checkout' }));
  });

  test('a path that is not a worktree of this repository is refused', async () => {
    const repo = makeRepo('remove-stranger');
    const stranger = path.join(FIXTURE_ROOT, 'stranger');
    fs.mkdirSync(stranger, { recursive: true });
    const failure = removeWorktree({ projectPath: repo, worktreePath: stranger }, registry());
    await failure.catch((error) => expect(error).toMatchObject({ code: 'not_a_worktree' }));
  });

  test('a worktree whose folder was deleted outside Kabmo still removes, and prunes', async () => {
    const repo = makeRepo('remove-vanished');
    const created = await createWorktree({ projectPath: repo, mode: 'new', branch: 'wt/vanish' }, createDeps());
    fs.rmSync(created.path, { recursive: true, force: true });

    // It is still listed — that is what keeps its sessions on screen.
    expect((await listWorktrees(repo)).some((entry) => entry.path === created.path)).toBe(true);

    const result = await removeWorktree(
      { projectPath: repo, worktreePath: created.path, deleteBranch: true, managedRoot: MANAGED_ROOT },
      registry(),
    );
    expect(result.removed).toBe(true);
    expect((await listWorktrees(repo)).some((entry) => entry.path === created.path)).toBe(false);
  });

  test('children are stopped BEFORE the directory disappears', async () => {
    const repo = makeRepo('remove-order');
    const created = await createWorktree({ projectPath: repo, mode: 'new', branch: 'wt/order' }, createDeps());

    // A child that simply waits: `await new Promise(() => {})` never settles, so
    // the process stays alive without a timer a test would have to wait on.
    const child = Bun.spawn({
      cmd: ['bun', '-e', 'await new Promise(() => {});'],
      cwd: created.path,
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
    });

    const order: string[] = [];
    const result = await removeWorktree(
      {
        projectPath: repo,
        worktreePath: created.path,
        managedRoot: MANAGED_ROOT,
        stopSessions: async (worktreePath) => {
          order.push(`stop:${path.basename(worktreePath)}`);
          child.kill();
          await child.exited;
          return ['session-1'];
        },
      },
      registry(),
    );
    order.push('removed');

    expect(order).toEqual(['stop:order', 'removed']);
    expect(result.archived).toEqual(['session-1']);
    expect(fs.existsSync(created.path)).toBe(false);
    // A SIGTERM'd process reports `signalCode`, not an exit code.
    expect(child.signalCode).toBe('SIGTERM');
  });

  test('a refusal after the sessions are stopped leaves a worktree that can be retried', async () => {
    const repo = makeRepo('remove-retry');
    const created = await createWorktree({ projectPath: repo, mode: 'new', branch: 'wt/retry' }, createDeps());
    fs.writeFileSync(path.join(created.path, 'dirty.txt'), 'x');

    const failure = removeWorktree(
      {
        projectPath: repo,
        worktreePath: created.path,
        managedRoot: MANAGED_ROOT,
        stopSessions: async () => ['session-1'],
      },
      registry(),
    );
    await failure.catch((error) => expect(error).toMatchObject({ code: 'dirty' }));

    expect(fs.existsSync(created.path)).toBe(true);
    expect((await listWorktrees(repo)).some((entry) => entry.path === created.path)).toBe(true);
  });
});
