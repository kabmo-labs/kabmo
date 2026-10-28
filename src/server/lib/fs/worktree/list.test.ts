/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Worktree listing, against real repositories.
 *
 * Three answers here cannot be faked by a hand-written porcelain string, and
 * each is a case that has to keep working:
 *
 *  - a linked worktree is NOT the primary, and a deleted directory is `missing`
 *    while its entry stays in the list (the sessions that lived there must keep
 *    their row);
 *  - two spellings of one directory reconcile — on macOS git prints
 *    `/private/tmp/...` for a path the caller typed as `/tmp/...`, and a
 *    comparison that ignored that decided a worktree was not inside itself;
 *  - the session → worktree lookup picks the INNER worktree, because that is
 *    the directory the agent writes to.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonicalPath, pathHolds } from '@/server/lib/fs/canonical';
import { findBranchInUse, listWorktrees, parseWorktreePorcelain } from '@/server/lib/fs/worktree/list';
import { invalidateWorktreeTopology, readProjectWorktrees, worktreeForCwd } from '@/server/lib/fs/worktree/topology';
import { removeDir } from '@/test-support/remove-dir';

const FIXTURE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-worktree-list-'));

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync({
    cmd: ['git', ...args],
    cwd,
    env: { ...Bun.env, GIT_EDITOR: 'true', GIT_TERMINAL_PROMPT: '0' },
  });
  return result.stdout.toString();
}

function makeRepo(name: string): string {
  const dir = path.join(FIXTURE_ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main', '.');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(dir, 'f.txt'), 'a\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

afterAll(async () => {
  await invalidateWorktreeTopology();
  removeDir(FIXTURE_ROOT);
});

describe('parseWorktreePorcelain', () => {
  const PORCELAIN = [
    'worktree /repo',
    'HEAD aaa',
    'branch refs/heads/main',
    '',
    'worktree /wt/detached',
    'HEAD bbb',
    'detached',
    '',
    'worktree /wt/gone',
    'HEAD ccc',
    'branch refs/heads/feat',
    'prunable gitdir file points to non-existent location',
    '',
    'worktree /bare',
    'bare',
    '',
  ].join('\n');

  test('reads the branch, a detached HEAD, a prunable entry, and drops a bare repo', () => {
    const entries = parseWorktreePorcelain(PORCELAIN);
    expect(entries.map((entry) => entry.path)).toEqual(['/repo', '/wt/detached', '/wt/gone']);
    expect(entries[0]?.branch).toBe('main');
    expect(entries[1]?.detached).toBe(true);
    expect(entries[1]?.branch).toBe('');
    expect(entries[2]?.missing).toBe(true);
  });

  test('a bare repository is not a checkout anything can run in', () => {
    expect(parseWorktreePorcelain(PORCELAIN).some((entry) => entry.path === '/bare')).toBe(false);
  });
});

describe('listWorktrees', () => {
  test('flags the primary and a linked worktree apart', async () => {
    const repo = makeRepo('list-basic');
    const linked = path.join(FIXTURE_ROOT, 'list-basic-wt');
    git(repo, 'worktree', 'add', '-q', '-b', 'feat', linked);

    const entries = await listWorktrees(repo);
    const primary = entries.find((entry) => entry.isPrimary);
    const other = entries.find((entry) => !entry.isPrimary);
    expect(primary?.path).toBe(await canonicalPath(repo));
    expect(other?.branch).toBe('feat');
    expect(other?.missing).toBe(false);
    // Paths come back canonical, whichever spelling git was handed.
    expect(other?.path).toBe(await canonicalPath(linked));
  });

  test('a directory deleted outside git stays listed as missing', async () => {
    const repo = makeRepo('list-missing');
    const linked = path.join(FIXTURE_ROOT, 'list-missing-wt');
    git(repo, 'worktree', 'add', '-q', '-b', 'gone', linked);
    fs.rmSync(linked, { recursive: true, force: true });

    const entries = await listWorktrees(repo);
    const entry = entries.find((candidate) => !candidate.isPrimary);
    expect(entry?.missing).toBe(true);
    // And the missing path still canonicalizes, so it can be matched at all.
    expect(entry?.path).toBe(await canonicalPath(linked));
  });

  test('findBranchInUse names the worktree that holds a branch', async () => {
    const repo = makeRepo('list-in-use');
    const linked = path.join(FIXTURE_ROOT, 'list-in-use-wt');
    git(repo, 'worktree', 'add', '-q', '-b', 'held', linked);

    const hit = await findBranchInUse(repo, 'held');
    expect(hit?.path).toBe(await canonicalPath(linked));
    expect(await findBranchInUse(repo, 'free')).toBeNull();
  });
});

describe('canonical paths', () => {
  test('a sibling sharing a prefix is not inside', async () => {
    const base = path.join(FIXTURE_ROOT, 'holds');
    fs.mkdirSync(path.join(base, 'repo', 'src'), { recursive: true });
    fs.mkdirSync(path.join(base, 'repo-other'), { recursive: true });

    expect(await pathHolds(path.join(base, 'repo'), path.join(base, 'repo'))).toBe(true);
    expect(await pathHolds(path.join(base, 'repo'), path.join(base, 'repo', 'src'))).toBe(true);
    expect(await pathHolds(path.join(base, 'repo'), path.join(base, 'repo-other'))).toBe(false);
  });

  test('a MISSING path resolves through its nearest existing ancestor', async () => {
    const base = path.join(FIXTURE_ROOT, 'canonical-missing');
    fs.mkdirSync(base, { recursive: true });
    const missing = path.join(base, 'gone', 'deeper');
    expect(await canonicalPath(missing)).toBe(path.join(await canonicalPath(base), 'gone', 'deeper'));
  });

  test('`..` cannot escape', async () => {
    const base = path.join(FIXTURE_ROOT, 'canonical-escape');
    fs.mkdirSync(base, { recursive: true });
    expect(await pathHolds(base, path.join(base, '..', 'elsewhere'))).toBe(false);
  });
});

describe('session → worktree', () => {
  test('an inner worktree wins over the checkout that contains it', async () => {
    const repo = makeRepo('topology');
    const outer = path.join(FIXTURE_ROOT, 'topology-outer');
    git(repo, 'worktree', 'add', '-q', '-b', 'outer', outer);
    fs.mkdirSync(path.join(outer, 'sub'), { recursive: true });

    const entries = await listWorktrees(repo);
    const primary = entries.find((entry) => entry.isPrimary)?.path as string;

    const inner = await worktreeForCwd(entries, path.join(outer, 'sub'), primary);
    expect(inner?.path).toBe(await canonicalPath(outer));
    expect(inner?.branch).toBe('outer');
    expect(inner?.status).toBe('ready');

    // A session in the checkout itself has no badge — it is not a worktree session.
    expect(await worktreeForCwd(entries, primary, primary)).toBeNull();
  });

  test('a missing worktree still answers, with status `missing`', async () => {
    const repo = makeRepo('topology-missing');
    const linked = path.join(FIXTURE_ROOT, 'topology-missing-wt');
    git(repo, 'worktree', 'add', '-q', '-b', 'vanish', linked);
    fs.rmSync(linked, { recursive: true, force: true });

    const entries = await listWorktrees(repo);
    const primary = entries.find((entry) => entry.isPrimary)?.path as string;
    const badge = await worktreeForCwd(entries, linked, primary);
    expect(badge?.status).toBe('missing');
    expect(badge?.branch).toBe('vanish');
  });

  test('the topology read is cached, and invalidation drops it', async () => {
    const repo = makeRepo('topology-cache');
    const first = await readProjectWorktrees(repo);
    const second = await readProjectWorktrees(repo);
    expect(second).toBe(first); // same array identity — a real cache hit

    const linked = path.join(FIXTURE_ROOT, 'topology-cache-wt');
    git(repo, 'worktree', 'add', '-q', '-b', 'new-one', linked);
    // Cached: the new worktree is not visible yet.
    expect((await readProjectWorktrees(repo)).length).toBe(1);

    // AWAITED: the invalidation resolves the canonical key asynchronously, so an
    // un-awaited call races the read below — measured on both CI legs, where the
    // read won and the cache still answered one entry.
    await invalidateWorktreeTopology(await canonicalPath(repo));
    expect((await readProjectWorktrees(repo)).length).toBe(2);
  });
});
