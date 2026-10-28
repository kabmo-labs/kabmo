/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Blame against a REAL repository on a temp disk.
 *
 * A stubbed `git` would prove nothing here: every branch this module has is a
 * sentence git itself produced (measured — `fatal: no such path 'x' in HEAD`
 * for an untracked file, `fatal: Needed a single revision` for an unborn HEAD,
 * `fatal: not a git repository (or any of the parent directories)` outside a
 * repository), and the cache key is a fact about the FILESYSTEM, not about the
 * call. So each case builds a repository, commits, and asks.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { readBlame, readBlameHistory, resetBlameCache } from '@/server/lib/fs/git-blame';
import { isUncommittedSha } from '@/shared/lib/fs/git-blame';

let root: string;

function git(cwd: string, args: string[]): void {
  const result = Bun.spawnSync({
    cmd: ['git', ...args],
    cwd,
    env: {
      ...Bun.env,
      GIT_AUTHOR_NAME: 'Ada Lovelace',
      GIT_AUTHOR_EMAIL: 'ada@example.com',
      GIT_COMMITTER_NAME: 'Ada Lovelace',
      GIT_COMMITTER_EMAIL: 'ada@example.com',
      GIT_AUTHOR_DATE: '2023-11-14T22:13:20Z',
      GIT_COMMITTER_DATE: '2023-11-14T22:13:20Z',
    },
    stdout: 'ignore',
    stderr: 'pipe',
  });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'kabmo-blame-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A fresh repository with one committed file, per test. */
function repo(name: string, files: Record<string, string>): string {
  const dir = join(root, name);
  mkdtempSync(join(root, `${name}-`));
  Bun.spawnSync({ cmd: ['mkdir', '-p', dir] });
  git(dir, ['init', '-q', '-b', 'main']);
  for (const [path, body] of Object.entries(files)) writeFileSync(join(dir, path), body);
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'feat: the first commit']);
  return dir;
}

describe('readBlame', () => {
  test('attributes every line and reports the line count', async () => {
    const dir = repo('basic', { 'a.ts': 'one\ntwo\nthree\n' });
    const payload = await readBlame(dir, 'a.ts');

    expect(payload.available).toBe(true);
    expect(payload.lines).toBe(3);
    expect(payload.runs).toEqual([{ from: 1, to: 3, sha: payload.head! }]);
    const commit = payload.commits[payload.head!];
    expect(commit.author).toBe('Ada Lovelace');
    expect(commit.summary).toBe('feat: the first commit');
    // 2023-11-14T22:13:20Z, and the fixture pins the date so this is exact.
    expect(commit.time).toBe(1700000000);
  });

  test('a later commit splits the runs, and the older lines keep their author', async () => {
    const dir = repo('two-commits', { 'b.ts': 'one\ntwo\nthree\n' });
    writeFileSync(join(dir, 'b.ts'), 'one\nTWO\nthree\n');
    git(dir, ['commit', '-q', '-am', 'fix: change the middle line']);

    const payload = await readBlame(dir, 'b.ts');
    expect(payload.runs).toHaveLength(3);
    const middle = payload.runs[1];
    expect(middle.from).toBe(2);
    expect(payload.commits[middle.sha].summary).toBe('fix: change the middle line');
    expect(payload.commits[payload.runs[0].sha].summary).toBe('feat: the first commit');
  });

  test('a line in the working tree that HEAD does not have is the all-zero sha', async () => {
    const dir = repo('dirty', { 'c.ts': 'one\ntwo\n' });
    // Three lines on disk, two in HEAD: line 3 is unattributable.
    writeFileSync(join(dir, 'c.ts'), 'one\ntwo\nthree\n');

    const payload = await readBlame(dir, 'c.ts');
    expect(payload.available).toBe(true);
    const last = payload.runs[payload.runs.length - 1];
    expect(last.to).toBe(3);
    expect(isUncommittedSha(last.sha)).toBe(true);
  });

  test('an untracked file is answered, not thrown', async () => {
    const dir = repo('untracked', { 'kept.ts': 'x\n' });
    writeFileSync(join(dir, 'new.ts'), 'x\n');

    const payload = await readBlame(dir, 'new.ts');
    expect(payload.available).toBe(false);
    expect(payload.reason).toBe('untracked');
    expect(payload.message).toContain('no such path');
  });

  test('a directory that is not a repository says so', async () => {
    const dir = join(root, 'plain');
    Bun.spawnSync({ cmd: ['mkdir', '-p', dir] });
    writeFileSync(join(dir, 'x.ts'), 'x\n');

    const payload = await readBlame(dir, 'x.ts');
    expect(payload.available).toBe(false);
    expect(payload.reason).toBe('not-repo');
  });

  test('an empty file has no lines rather than an empty answer', async () => {
    const dir = repo('empty', { 'e.ts': '' });
    const payload = await readBlame(dir, 'e.ts');
    expect(payload.available).toBe(false);
    expect(payload.reason).toBe('empty');
  });

  test('a path escaping the repository is refused before git sees it', async () => {
    const dir = repo('escape', { 'a.ts': 'x\n' });
    const payload = await readBlame(dir, '../../etc/passwd');
    expect(payload.available).toBe(false);
    expect(payload.reason).toBe('error');
    expect(payload.message).toBe('Invalid path');
  });

  test('the second read is served from the cache, and a commit invalidates it', async () => {
    const dir = repo('cache', { 'a.ts': 'one\ntwo\n' });
    resetBlameCache();

    const first = await readBlame(dir, 'a.ts');
    expect(first.head).toBeTruthy();
    // A different HEAD must not be served the previous answer: every line's
    // author can change with one commit, which is what the key carries.
    writeFileSync(join(dir, 'a.ts'), 'one\ntwo\nthree\n');
    git(dir, ['commit', '-q', '-am', 'feat: a third line']);

    const second = await readBlame(dir, 'a.ts');
    expect(second.head).not.toBe(first.head);
    expect(second.lines).toBe(3);
  });

  test('an edit on disk invalidates it even with HEAD unmoved', async () => {
    const dir = repo('mtime', { 'a.ts': 'one\ntwo\n' });
    resetBlameCache();
    const first = await readBlame(dir, 'a.ts');
    expect(first.lines).toBe(2);

    // The autosave path: the file grows, HEAD does not move, and line 3 has no
    // attribution — a cached payload would report a 2-line file forever.
    writeFileSync(join(dir, 'a.ts'), 'one\ntwo\nthree\n');
    const second = await readBlame(dir, 'a.ts');
    expect(second.lines).toBe(3);
  });
});

describe('readBlameHistory', () => {
  test('lists every commit that touched the line, newest first', async () => {
    const dir = repo('history', { 'a.ts': 'alpha\nbeta\ngamma\n' });
    writeFileSync(join(dir, 'a.ts'), 'alpha\nBETA\ngamma\n');
    git(dir, ['commit', '-q', '-am', 'fix: the middle again']);

    const history = await readBlameHistory(dir, 'a.ts', 2);
    expect(history.entries.length).toBe(2);
    expect(history.entries[0].summary).toBe('fix: the middle again');
    expect(history.entries[1].summary).toBe('feat: the first commit');
    expect(history.entries[0].author).toBe('Ada Lovelace');
    expect(history.truncated).toBe(false);
  });

  test('a line no commit touched is the single commit that created it', async () => {
    const dir = repo('history-one', { 'a.ts': 'alpha\nbeta\n' });
    const history = await readBlameHistory(dir, 'a.ts', 1);
    expect(history.entries.map((entry) => entry.summary)).toEqual(['feat: the first commit']);
  });

  test('a line past the end of the file is empty, not an error', async () => {
    const dir = repo('history-past', { 'a.ts': 'alpha\n' });
    expect(await readBlameHistory(dir, 'a.ts', 99)).toEqual({ entries: [], truncated: false });
  });

  test('a non-positive line is refused without spawning git', async () => {
    const dir = repo('history-bad', { 'a.ts': 'alpha\n' });
    expect(await readBlameHistory(dir, 'a.ts', 0)).toEqual({ entries: [], truncated: false });
    expect(await readBlameHistory(dir, 'a.ts', 1.5)).toEqual({ entries: [], truncated: false });
  });

  test('a file outside the repository is refused', async () => {
    const dir = repo('history-escape', { 'a.ts': 'alpha\n' });
    expect(await readBlameHistory(dir, '../outside.ts', 1)).toEqual({ entries: [], truncated: false });
  });
});
