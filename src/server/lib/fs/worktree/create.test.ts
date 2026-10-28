/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Creating a worktree, against real repositories.
 *
 * The refusals are the point of this file. git creates the branch BEFORE it
 * discovers the problem — measured on 2.56: `Preparing worktree` is printed,
 * the branch exists, and only then does the command fail with "already checked
 * out", "already exists", or (unborn) `object not found: HEAD`. A create that
 * relied on git's own ordering would leave a branch behind for an operation the
 * user was told had failed, so every check runs first and this file proves
 * nothing is left over.
 *
 * The ignored-file carry is the second half: plain `git worktree add` does NOT
 * copy `node_modules`, so a fresh worktree cannot run a project that worked a
 * second earlier in the checkout.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonicalPath } from '@/server/lib/fs/canonical';
import { createWorktree, planWorktree, type CreateWorktreeDeps } from '@/server/lib/fs/worktree/create';
import { WorktreeError } from '@/server/lib/fs/worktree/errors';
import { listWorktrees } from '@/server/lib/fs/worktree/list';
import { invalidateWorktreeTopology } from '@/server/lib/fs/worktree/topology';
import { removeDir } from '@/test-support/remove-dir';

const FIXTURE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-worktree-create-'));
const DATA_DIR = path.join(FIXTURE_ROOT, 'data');

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync({
    cmd: ['git', ...args],
    cwd,
    env: { ...GIT_ENV_FOR_TESTS },
  });
  return result.stdout.toString();
}

const GIT_ENV_FOR_TESTS = {
  ...Bun.env,
  GIT_EDITOR: 'true',
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
};

/** A repository with one commit, a gitignored `node_modules` and a `.env`. */
function makeRepo(name: string): string {
  const dir = path.join(FIXTURE_ROOT, name);
  fs.mkdirSync(path.join(dir, 'node_modules', 'dep'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\n.env\n');
  fs.writeFileSync(path.join(dir, 'node_modules', 'dep', 'index.js'), 'module.exports = {};\n');
  fs.writeFileSync(path.join(dir, '.env'), 'SECRET=1\n');
  fs.writeFileSync(path.join(dir, 'readme.md'), 'hello\n');
  git(dir, 'init', '-q', '-b', 'main', '.');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

function makeEmptyRepo(name: string): string {
  const dir = path.join(FIXTURE_ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main', '.');
  return dir;
}

/** The registry, as a Map — the production one is a SQLite row write. */
function depsFor(records: Map<string, { startRef: string; projectId: string }>): CreateWorktreeDeps {
  return {
    identityFor: async () => null,
    carryIgnored: true,
    dataDir: DATA_DIR,
    configuredDirectory: null,
    record: async (row) => {
      records.set(await canonicalPath(row.path), { startRef: row.startRef, projectId: row.projectId });
    },
  };
}

afterAll(async () => {
  await invalidateWorktreeTopology();
  removeDir(FIXTURE_ROOT);
});

describe('createWorktree', () => {
  test('a new branch, a folder that follows it, and our prefix stripped', async () => {
    const repo = makeRepo('create-basic');
    const records = new Map<string, { startRef: string; projectId: string }>();
    const created = await createWorktree(
      { projectPath: repo, mode: 'new', branch: 'wt/cosmic-dolphin' },
      depsFor(records),
    );

    expect(created.branch).toBe('wt/cosmic-dolphin');
    expect(path.basename(created.path)).toBe('cosmic-dolphin');
    expect(fs.existsSync(created.path)).toBe(true);
    expect(git(created.path, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('wt/cosmic-dolphin');
    // `start_ref` is the one value git cannot answer later, so it is recorded.
    expect(records.get(await canonicalPath(created.path))?.startRef).toBe('HEAD');
    // The default root is keyed by the repository's identity. Canonicalized
    // because the fixture root itself resolves through a symlink on macOS.
    expect(created.path.startsWith(await canonicalPath(path.join(DATA_DIR, 'worktrees')))).toBe(true);
  });

  test('ignored build folders and .env come along, and the worktree stays clean', async () => {
    const repo = makeRepo('create-carry');
    const created = await createWorktree(
      { projectPath: repo, mode: 'new', branch: 'wt/carry' },
      depsFor(new Map()),
    );

    expect(fs.existsSync(path.join(created.path, 'node_modules', 'dep', 'index.js'))).toBe(true);
    expect(fs.readFileSync(path.join(created.path, '.env'), 'utf8')).toContain('SECRET');
    expect(created.carried?.copied).toContain('node_modules');
    expect(created.carried?.strategy).toBe(
      process.platform === 'darwin' ? 'clonefile' : process.platform === 'linux' ? 'reflink' : 'plain',
    );
    // A carry must not make the new worktree dirty: `git status` there is what a
    // commit from that tree would be built on.
    const status = git(created.path, 'status', '--porcelain').trim();
    expect(status).toBe('');
  });

  test('the carry can be turned off, and turns nothing else off', async () => {
    const repo = makeRepo('create-no-carry');
    const created = await createWorktree(
      { projectPath: repo, mode: 'new', branch: 'wt/no-carry', carryIgnored: false },
      depsFor(new Map()),
    );
    expect(fs.existsSync(path.join(created.path, 'node_modules'))).toBe(false);
    expect(created.carried).toBeNull();
  });

  test('an existing branch is checked out as it is, and gets no start ref', async () => {
    const repo = makeRepo('create-existing');
    git(repo, 'branch', 'free-branch');
    const created = await createWorktree(
      { projectPath: repo, mode: 'existing', branch: 'free-branch' },
      depsFor(new Map()),
    );

    expect(created.branch).toBe('free-branch');
    expect(created.createdBranch).toBe(false);
    expect(created.startRef).toBe('');
    expect(git(created.path, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('free-branch');
  });

  test('an existing branch already checked out is refused before anything is created', async () => {
    const repo = makeRepo('create-in-use');
    const failure = createWorktree(
      { projectPath: repo, mode: 'existing', branch: 'main' },
      depsFor(new Map()),
    );
    await expect(failure).rejects.toThrow(/already checked out/i);
    expect((await listWorktrees(repo)).filter((entry) => !entry.isPrimary).length).toBe(0);
  });

  test('an unborn repository is refused with its own code', async () => {
    const empty = makeEmptyRepo('create-unborn');
    const failure = createWorktree({ projectPath: empty, mode: 'new', branch: 'wt/x' }, depsFor(new Map()));
    await expect(failure).rejects.toBeInstanceOf(WorktreeError);
    await failure.catch((error: WorktreeError) => expect(error.code).toBe('no_commits'));
  });

  test('a branch that already exists is refused, and leaves no second worktree', async () => {
    const repo = makeRepo('create-dup');
    const records = new Map<string, { startRef: string; projectId: string }>();
    const first = await createWorktree({ projectPath: repo, mode: 'new', branch: 'wt/dup' }, depsFor(records));

    const failure = createWorktree({ projectPath: repo, mode: 'new', branch: 'wt/dup' }, depsFor(records));
    await failure.catch((error: WorktreeError) => expect(error.code).toBe('branch_exists'));

    const entries = await listWorktrees(repo);
    expect(entries.filter((entry) => !entry.isPrimary).length).toBe(1);
    expect(entries.some((entry) => entry.path === first.path)).toBe(true);
  });

  test('an invalid branch name never reaches git', async () => {
    const repo = makeRepo('create-bad-name');
    const failure = createWorktree({ projectPath: repo, mode: 'new', branch: 'has space' }, depsFor(new Map()));
    await failure.catch((error: WorktreeError) => expect(error.code).toBe('invalid_name'));
  });

  test('a taken folder name is suffixed, never refused', async () => {
    const repo = makeRepo('create-collide');
    const records = new Map<string, { startRef: string; projectId: string }>();
    const first = await createWorktree(
      { projectPath: repo, mode: 'new', branch: 'wt/one', worktreeName: 'same' },
      depsFor(records),
    );
    const second = await createWorktree(
      { projectPath: repo, mode: 'new', branch: 'wt/two', worktreeName: 'same' },
      depsFor(records),
    );

    expect(path.basename(first.path)).toBe('same');
    expect(path.basename(second.path)).not.toBe('same');
    expect(path.basename(second.path).startsWith('same-')).toBe(true);
  });

  test('a non-Latin branch gets a generated folder instead of an empty one', async () => {
    const repo = makeRepo('create-cjk');
    const created = await createWorktree(
      { projectPath: repo, mode: 'new', branch: '分支/测试' },
      depsFor(new Map()),
    );
    expect(path.basename(created.path).length).toBeGreaterThan(0);
    // The branch is what the caller typed, verbatim — only the FOLDER needed a
    // generated name because the branch left no slug.
    expect(created.branch).toBe('分支/测试');
  });
});

describe('planWorktree', () => {
  test('answers the same refusals without touching disk', async () => {
    const repo = makeRepo('plan-none');
    const plan = await planWorktree(
      { projectPath: repo, mode: 'new', branch: 'wt/planned' },
      { identityFor: async () => null, dataDir: DATA_DIR, configuredDirectory: null },
    );
    expect(plan.branch).toBe('wt/planned');
    expect(fs.existsSync(plan.directory)).toBe(false);

    const dup = planWorktree(
      { projectPath: repo, mode: 'existing', branch: 'main' },
      { identityFor: async () => null, dataDir: DATA_DIR, configuredDirectory: null },
    );
    await dup.catch((error: WorktreeError) => expect(error.code).toBe('branch_in_use'));
  });

  test('a configured directory wins over the data-dir default', async () => {
    const repo = makeRepo('plan-configured');
    const configured = path.join(FIXTURE_ROOT, 'elsewhere');
    const plan = await planWorktree(
      { projectPath: repo, mode: 'new', branch: 'wt/configured' },
      { identityFor: async () => null, dataDir: DATA_DIR, configuredDirectory: configured },
    );
    expect(plan.directory.startsWith(await canonicalPath(configured))).toBe(true);
  });
});