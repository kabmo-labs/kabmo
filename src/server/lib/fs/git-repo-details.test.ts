/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The repository rows behind the repo management modal.
 *
 * Two things are pinned here and both fail silently if they drift.
 *
 * **The porcelain v2 dialect.** v1 prints the branch as prose — `## main...origin/main
 * [ahead 1, behind 2]`, plus the two degenerate spellings `## No commits yet on
 * main` and `## HEAD (no branch)` — while v2 states each fact on its own `#`
 * line. The forms below were measured against real repositories, including the
 * one that reads as success and is not: `branch.upstream` PRESENT with
 * `branch.ab` ABSENT is `[gone]` (the remote ref was deleted), which must never
 * render as "in sync".
 *
 * **An unmerged entry is a CONFLICT, not a change.** Its two letters are the two
 * sides of the conflict; counting it among ordinary changes is what once made
 * every conflicted file report as staged.
 *
 * The rows themselves are driven against real repositories, because the counts,
 * the unborn branch and the stopped operation are git's answers and not
 * something a hand-written porcelain string proves.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parsePorcelainV2 } from '@/server/lib/fs/git-porcelain-v2';
import { readRepoDetail, readRepoDetails } from '@/server/lib/fs/git-repo-details';
import { removeDir } from '@/test-support/remove-dir';

const FIXTURE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'ompchamber-repo-details-'));

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync({
    cmd: ['git', ...args],
    cwd,
    env: { ...Bun.env, GIT_EDITOR: 'true', GIT_TERMINAL_PROMPT: '0' },
  });
  return result.stdout.toString();
}

/** A repository with one commit, under the fixture root, at `name`. */
function makeRepo(name: string, branch = 'main'): string {
  const dir = path.join(FIXTURE_ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', branch, '.');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(dir, 'f.txt'), 'a\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', `${name} base`);
  return dir;
}

afterAll(() => {
  removeDir(FIXTURE_ROOT);
});

describe('parsePorcelainV2', () => {
  test('reads the branch, the upstream and its ahead/behind track', () => {
    const summary = parsePorcelainV2(
      '# branch.oid abc\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +1 -2\0',
    );
    expect(summary.branch).toBe('main');
    expect(summary.upstream).toBe('origin/main');
    expect(summary.ahead).toBe(1);
    expect(summary.behind).toBe(2);
    expect(summary.gone).toBe(false);
  });

  test('an upstream with NO track is gone, never in sync', () => {
    // The remote ref was deleted (`git fetch --prune` after a remote delete).
    // `branch.ab` is absent in exactly this case, which is what distinguishes it
    // from a genuine `+0 -0`.
    const summary = parsePorcelainV2('# branch.oid abc\0# branch.head main\0# branch.upstream origin/main\0');
    expect(summary.upstream).toBe('origin/main');
    expect(summary.gone).toBe(true);
    expect(summary.ahead).toBe(0);
    expect(summary.behind).toBe(0);

    const inSync = parsePorcelainV2(
      '# branch.oid abc\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +0 -0\0',
    );
    expect(inSync.gone).toBe(false);
  });

  test('a branch with no upstream is unpublished, not gone', () => {
    const summary = parsePorcelainV2('# branch.oid abc\0# branch.head feature\0');
    expect(summary.upstream).toBe('');
    expect(summary.gone).toBe(false);
  });

  test('an unborn branch reports no commits and keeps its name', () => {
    const summary = parsePorcelainV2('# branch.oid (initial)\0# branch.head main\0');
    expect(summary.hasCommits).toBe(false);
    expect(summary.branch).toBe('main');
  });

  test('a detached HEAD reports the short sha, not the literal HEAD', () => {
    const summary = parsePorcelainV2('# branch.oid abcdef1234567\0# branch.head (detached)\0');
    expect(summary.detached).toBe(true);
    expect(summary.branch).toBe('abcdef1');
  });

  test('counts changed, untracked and conflicted records separately', () => {
    const summary = parsePorcelainV2(
      '1 .M N... 100644 100644 100644 a b f.txt\0' +
        'u UU N... 100644 100644 100644 100644 a b c f.txt\0' +
        '? untracked.txt\0',
    );
    expect(summary.changed).toBe(1);
    expect(summary.conflicts).toBe(1);
    expect(summary.untracked).toBe(1);
  });

  test('a rename spends two records and counts once', () => {
    const summary = parsePorcelainV2('2 RM N... 100644 100644 100644 a b R100 new.txt\0old.txt\0');
    expect(summary.changed).toBe(1);
    expect(summary.untracked).toBe(0);
    expect(summary.conflicts).toBe(0);
  });

  test('an empty listing is an empty summary, not a crash', () => {
    const summary = parsePorcelainV2('');
    expect(summary.changed).toBe(0);
    expect(summary.branch).toBe('');
    expect(summary.hasCommits).toBe(false);
  });
});

describe('readRepoDetail', () => {
  test('reports the branch, the counts and HEAD for a real repository', async () => {
    const dir = makeRepo('clean');
    fs.writeFileSync(path.join(dir, 'f.txt'), 'changed\n');
    fs.writeFileSync(path.join(dir, 'new.txt'), 'untracked\n');

    const row = await readRepoDetail(FIXTURE_ROOT, 'clean');
    expect(row.isRepo).toBe(true);
    expect(row.branch).toBe('main');
    expect(row.detached).toBe(false);
    expect(row.changed).toBe(1);
    expect(row.untracked).toBe(1);
    expect(row.subject).toBe('clean base');
    expect(row.date).not.toBe('');
    expect(row.operation).toBeNull();
    expect(row.error).toBeUndefined();
  });

  test('an unborn branch has no HEAD to read and says so without erroring', async () => {
    const dir = path.join(FIXTURE_ROOT, 'unborn');
    fs.mkdirSync(dir, { recursive: true });
    git(dir, 'init', '-q', '-b', 'main', '.');

    const row = await readRepoDetail(FIXTURE_ROOT, 'unborn');
    expect(row.isRepo).toBe(true);
    expect(row.branch).toBe('main');
    expect(row.subject).toBe('');
    expect(row.date).toBe('');
  });

  test('a directory that is not a repository answers isRepo false with git\u2019s reason', async () => {
    const dir = path.join(FIXTURE_ROOT, 'plain');
    fs.mkdirSync(dir, { recursive: true });

    const row = await readRepoDetail(FIXTURE_ROOT, 'plain');
    expect(row.isRepo).toBe(false);
    expect(row.error).toBeTruthy();
    expect(row.changed).toBe(0);
  });

  test('a stopped merge is reported as the operation, with its conflict count', async () => {
    const dir = makeRepo('conflicted');
    git(dir, 'checkout', '-q', '-b', 'feature');
    fs.writeFileSync(path.join(dir, 'f.txt'), 'feature\n');
    git(dir, 'commit', '-q', '-am', 'feature change');
    git(dir, 'checkout', '-q', 'main');
    fs.writeFileSync(path.join(dir, 'f.txt'), 'main\n');
    git(dir, 'commit', '-q', '-am', 'main change');
    // A conflicting merge exits 1 with the state left behind — the whole point.
    git(dir, 'merge', 'feature');

    const row = await readRepoDetail(FIXTURE_ROOT, 'conflicted');
    expect(row.operation).toBe('merge');
    expect(row.conflicts).toBe(1);
    // A conflicted file is NOT an ordinary change: it is the conflict itself.
    expect(row.changed).toBe(0);
  });

  test('a conflicting stash pop is `stash-pop`, the shape with no operation file', async () => {
    const dir = makeRepo('stash-pop');
    fs.writeFileSync(path.join(dir, 'f.txt'), 'stashed\n');
    git(dir, 'stash', 'push', '-q');
    fs.writeFileSync(path.join(dir, 'f.txt'), 'worktree\n');
    git(dir, 'commit', '-q', '-am', 'worktree change');
    // `git stash pop` refuses to overwrite and leaves the conflict in place.
    git(dir, 'stash', 'pop');

    const row = await readRepoDetail(FIXTURE_ROOT, 'stash-pop');
    expect(row.operation).toBe('stash-pop');
    expect(row.conflicts).toBe(1);
  });

  test('a path escaping the root is refused, not read', async () => {
    const row = await readRepoDetail(FIXTURE_ROOT, '../outside');
    expect(row.isRepo).toBe(false);
    expect(row.error).toBe('Invalid repo path');
  });
});

describe('readRepoDetails', () => {
  test('answers one row per repo, in the order it was given', async () => {
    makeRepo('order-a');
    makeRepo('order-b');
    const rows = await readRepoDetails(FIXTURE_ROOT, ['order-a', 'order-b']);
    expect(rows.map((r) => r.path)).toEqual(['order-a', 'order-b']);
    expect(rows.every((r) => r.isRepo)).toBe(true);
  });

  test('an empty list answers no rows', async () => {
    expect(await readRepoDetails(FIXTURE_ROOT, [])).toEqual([]);
  });
});
