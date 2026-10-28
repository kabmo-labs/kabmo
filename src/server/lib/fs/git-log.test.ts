/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Commit-history paging against a real repository.
 *
 * Two failures have already shipped from this file: an empty stdout was
 * replaced with 20 rows from a different repository (so every real history
 * ended with foreign commits), and a branch with no commits was read as a git
 * failure rather than an empty history. These tests run a REAL repository in a
 * temp dir and pin the page/next-cursor contract (`limit`/`skip`/`hasMore`/
 * `total`), the merge/rename/delete rows, the empty and single-commit
 * repositories, and the MOCK-only sample fallback. The parser's own shapes —
 * the empty input, the body fence — live in `git-log-parse.test.ts`.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fetchFileDiff, fetchGitCommits, readHeadCommitMessage } from '@/server/lib/fs/git-log';
import { SAMPLE_GIT_COMMITS } from '@/client/data/mock/git-commits';
import { removeDir } from '@/test-support/remove-dir';

const tempDirs: string[] = [];

/**
 * Budget for a hook that SEEDS a repository.
 *
 * Each one runs a dozen `git` spawns back to back (`init`, `add`, `commit`,
 * `rev-parse`, …), and on a Windows runner a single spawn costs an order of
 * magnitude more than on Linux — measured: the diff fixture crossed Bun's
 * default 5 s hook budget on `Gates / Checks (Windows)` and the suite failed
 * with "a beforeEach/afterEach hook timed out", which names the wrong thing and
 * hides the cause. The budget is the fixture's, not the code's: every assertion
 * still runs on its own default timeout.
 */
const SEED_TIMEOUT_MS = 120_000;

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-gitlog-'));
  tempDirs.push(dir);
  return dir;
}

/** Monotonic clock so commit dates — and therefore --date-order — are fixed. */
let clock = 0;

function git(cwd: string, ...args: string[]): string {
  const stamp = new Date(Date.UTC(2024, 0, 1, 0, 0, clock++)).toISOString();
  const result = Bun.spawnSync({
    cmd: ['git', ...args],
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
      GIT_AUTHOR_DATE: stamp,
      GIT_COMMITTER_DATE: stamp,
    },
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString();
}

function initRepo(dir: string): void {
  git(dir, 'init', '-q', '-b', 'main');
}

function write(dir: string, rel: string, content: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function commitAll(dir: string, message: string): void {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
}

afterAll(() => {
  for (const dir of tempDirs) removeDir(dir);
});

describe('fetchGitCommits against a real repository', () => {
  const repo = tempDir();

  beforeAll(() => {
    initRepo(repo);
    write(repo, 'base.txt', 'base\n');
    commitAll(repo, 'c1 base');
    write(repo, 'added.txt', 'added\n');
    commitAll(repo, 'c2 add');
    write(repo, 'gone.txt', 'g1\ng2\n');
    commitAll(repo, 'c3 add gone');
    git(repo, 'rm', '-q', 'gone.txt');
    commitAll(repo, 'c4 delete gone');
    write(repo, 'old.txt', 'r\n');
    commitAll(repo, 'c5 add old');
    git(repo, 'mv', 'old.txt', 'new.txt');
    commitAll(repo, 'c6 rename old');
    git(repo, 'checkout', '-q', '-b', 'feature');
    write(repo, 'feature.txt', 'f\n');
    commitAll(repo, 'c7 feature');
    git(repo, 'checkout', '-q', 'main');
    write(repo, 'main-only.txt', 'm\n');
    commitAll(repo, 'c8 main only');
    git(repo, 'merge', '-q', '--no-ff', 'feature', '-m', 'c9 merge feature');
  }, SEED_TIMEOUT_MS);

  test('the first page is the newest commits and carries the real total', async () => {
    const page = await fetchGitCommits(repo, 2, 0);
    expect(page.commits).toHaveLength(2);
    expect(page.commits[0].message).toBe('c9 merge feature');
    expect(page.total).toBe(9);
    expect(page.hasMore).toBe(true);
  });

  test('skip walks the pages without dropping or repeating the boundary', async () => {
    const first = await fetchGitCommits(repo, 2, 0);
    const second = await fetchGitCommits(repo, 2, 2);
    expect(second.commits).toHaveLength(2);
    expect(second.hasMore).toBe(true);
    const seen = new Set([...first.commits, ...second.commits].map((c) => c.hash));
    expect(seen.size).toBe(4);
  });

  test('the last page does not claim there is more', async () => {
    const page = await fetchGitCommits(repo, 2, 8);
    expect(page.commits).toHaveLength(1);
    expect(page.hasMore).toBe(false);
    expect(page.total).toBe(9);
  });

  test('a skip past the end yields no rows but keeps the total', async () => {
    const page = await fetchGitCommits(repo, 2, 9);
    expect(page.commits).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect(page.total).toBe(9);
  });

  test('the default page size returns the whole small history', async () => {
    const page = await fetchGitCommits(repo);
    expect(page.commits).toHaveLength(9);
    expect(page.hasMore).toBe(false);
  });

  test('a merge commit carries both parents and no file rows', async () => {
    const { commits } = await fetchGitCommits(repo, 20, 0);
    const merge = commits.find((c) => c.message === 'c9 merge feature');
    expect(merge?.parents).toHaveLength(2);
    expect(merge?.files).toEqual([]);
  });

  test('rename and delete rows keep their numstat statuses', async () => {
    const { commits } = await fetchGitCommits(repo, 20, 0);
    const rename = commits.find((c) => c.message === 'c6 rename old');
    expect(rename?.files).toEqual([
      { file: 'old.txt => new.txt', status: 'R', additions: 0, deletions: 0 },
    ]);
    const remove = commits.find((c) => c.message === 'c4 delete gone');
    expect(remove?.files).toEqual([
      { file: 'gone.txt', status: 'D', additions: 0, deletions: 2 },
    ]);
  });

  test('an added file is reported as an addition', async () => {
    const { commits } = await fetchGitCommits(repo, 20, 0);
    const add = commits.find((c) => c.message === 'c2 add');
    expect(add?.files).toEqual([
      { file: 'added.txt', status: 'A', additions: 1, deletions: 0 },
    ]);
  });
});

describe('empty and single-commit repositories', () => {
  test('a repository with no commits is an empty history', async () => {
    const repo = tempDir();
    initRepo(repo);
    expect(await fetchGitCommits(repo, 5, 0)).toEqual({ commits: [], hasMore: false, total: 0 });
  });

  test('a repository with one commit reports no more pages', async () => {
    const repo = tempDir();
    initRepo(repo);
    write(repo, 'only.txt', 'one\n');
    commitAll(repo, 'only');
    const page = await fetchGitCommits(repo, 5, 0);
    expect(page.commits).toHaveLength(1);
    expect(page.commits[0].message).toBe('only');
    expect(page.hasMore).toBe(false);
    expect(page.total).toBe(1);
  });
});

describe('a commit body travels with the page', () => {
  const repo = tempDir();

  beforeAll(() => {
    initRepo(repo);
    write(repo, 'a.txt', 'a\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'subject line', '-m', 'body para one\n\nbody para two with a tab:\n\tindented');
    write(repo, 'b.txt', 'b\n');
    commitAll(repo, 'one line only');
  }, SEED_TIMEOUT_MS);

  test('the multi-line body is parsed out of the log format', async () => {
    const { commits } = await fetchGitCommits(repo, 10, 0);
    const withBody = commits.find((c) => c.message === 'subject line');
    expect(withBody?.body).toBe('body para one\n\nbody para two with a tab:\n\tindented');
  });

  test('a one-line commit carries no body', async () => {
    const { commits } = await fetchGitCommits(repo, 10, 0);
    const single = commits.find((c) => c.message === 'one line only');
    expect(single?.body).toBeUndefined();
  });
});

describe('readHeadCommitMessage', () => {
  test('a multi-line HEAD message round-trips whole, subject and body', async () => {
    const repo = tempDir();
    initRepo(repo);
    write(repo, 'a.txt', 'a\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'the subject', '-m', 'the body para');
    // The amend REPLACES the message, so seeding only the subject would drop
    // the body it replaced.
    expect(await readHeadCommitMessage(repo)).toBe('the subject\n\nthe body para');
  });

  test('HEAD is the newest commit, not the first', async () => {
    const repo = tempDir();
    initRepo(repo);
    write(repo, 'a.txt', 'a\n');
    commitAll(repo, 'oldest');
    write(repo, 'b.txt', 'b\n');
    commitAll(repo, 'newest');
    expect(await readHeadCommitMessage(repo)).toBe('newest');
  });

  test('a repository with no commits answers null, not an empty draft', async () => {
    const repo = tempDir();
    initRepo(repo);
    // `git log` exits 128 on an unborn HEAD; the panel must leave the draft
    // alone rather than seeding an empty message over the placeholder.
    expect(await readHeadCommitMessage(repo)).toBeNull();
  });
});

describe('fetchFileDiff commit patches', () => {
  const repo = tempDir();
  let addedHash = '';
  let deletedHash = '';
  let renameHash = '';

  beforeAll(() => {
    initRepo(repo);
    write(repo, 'base.txt', 'base\n');
    commitAll(repo, 'base');
    write(repo, 'added.txt', 'added\n');
    commitAll(repo, 'add');
    addedHash = git(repo, 'rev-parse', 'HEAD').trim();
    write(repo, 'gone.txt', 'g1\ng2\n');
    commitAll(repo, 'add gone');
    git(repo, 'rm', '-q', 'gone.txt');
    commitAll(repo, 'remove gone');
    deletedHash = git(repo, 'rev-parse', 'HEAD').trim();
    write(repo, 'old.txt', 'renamed content\n');
    commitAll(repo, 'add old');
    git(repo, 'mv', 'old.txt', 'new.txt');
    commitAll(repo, 'rename old');
    renameHash = git(repo, 'rev-parse', 'HEAD').trim();
  }, SEED_TIMEOUT_MS);

  test('an added file yields its creation patch', async () => {
    const diff = await fetchFileDiff(repo, addedHash, 'added.txt');
    expect(diff).toContain('new file mode');
    expect(diff).toContain('+added');
  });

  test('a deleted file yields its removal patch', async () => {
    const diff = await fetchFileDiff(repo, deletedHash, 'gone.txt');
    expect(diff).toContain('deleted file mode');
    expect(diff).toContain('-g1');
    expect(diff).toContain('-g2');
  });

  test('a numstat rename path is resolved to the new name', async () => {
    const diff = await fetchFileDiff(repo, renameHash, 'old.txt => new.txt');
    expect(diff).toContain('renamed content');
  });

  test('an unknown revision falls back to a readable stub, not a throw', async () => {
    const diff = await fetchFileDiff(repo, 'deadbeefdeadbeef', 'nope.txt');
    expect(diff).toContain('@@ -0,0 +1,6 @@');
    expect(diff).toContain('// File: nope.txt');
    expect(diff).toContain('// Commit: deadbeef');
  });
});

describe('the sample fallback is reserved for MOCK mode', () => {
  const missing = path.join(os.tmpdir(), 'kabmo-gitlog-does-not-exist');

  function withMock(value: string | undefined, fn: () => Promise<void>): Promise<void> {
    const previous = Bun.env.MOCK;
    if (value === undefined) delete Bun.env.MOCK;
    else Bun.env.MOCK = value;
    return fn().finally(() => {
      if (previous === undefined) delete Bun.env.MOCK;
      else Bun.env.MOCK = previous;
    });
  }

  test('a git failure in real mode answers empty, never sample rows', async () => {
    await withMock(undefined, async () => {
      expect(await fetchGitCommits(missing, 5, 0)).toEqual({ commits: [], hasMore: false, total: 0 });
    });
  });

  test('MOCK mode answers a paged slice of the samples', async () => {
    await withMock('true', async () => {
      const page = await fetchGitCommits(missing, 3, 1);
      expect(page.commits).toHaveLength(3);
      expect(page.commits[0].hash).toBe(SAMPLE_GIT_COMMITS[1].hash);
      expect(page.total).toBe(SAMPLE_GIT_COMMITS.length);
      expect(page.hasMore).toBe(true);
    });
  });
});
