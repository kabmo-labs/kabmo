/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The working-tree diff probe behind the Git panel's file view.
 *
 * `fetchWorkingFileDiff` has four diff sources (staged, untracked, working,
 * synthesized) and picks between them from the porcelain status of the file.
 * Getting that choice wrong shows an empty or wrong diff for exactly the files
 * the panel exists to explain, and the untracked path is a known trap: `git
 * diff --no-index` exits 1 when it produced a diff, so the module reads stdout
 * instead of trusting the exit code. These tests drive a real repository with
 * one file per state and pin the status, the staged flag, the hunk headers of
 * the unified output, the full-context mode, and the addition/deletion counts.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fetchWorkingFileDiff } from '@/server/lib/fs/git-diff';
import { isWindows, testPosix } from '@/test-support/platform';
import { removeDir } from '@/test-support/remove-dir';

const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-gitdiff-'));

function git(...args: string[]): void {
  const result = Bun.spawnSync({ cmd: ['git', ...args], cwd: repo });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString()}`);
  }
}

function write(rel: string, content: string): void {
  const full = path.join(repo, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

const EIGHT_LINES = 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\n';

beforeAll(() => {
  git('init', '-q', '-b', 'main');
  // Pin the line ending: a Windows host defaults `core.autocrlf` to true, which
  // rewrites every checked-out file to CRLF.
  git('config', 'core.autocrlf', 'false');
  git('config', 'core.eol', 'lf');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  write('mod.txt', EIGHT_LINES);
  write('staged.txt', 's1\n');
  write('clean.txt', 'c1\n');
  write('deleted.txt', 'd1\nd2\n');
  write('sub dir/f.txt', 'sub1\n');
  // Dot-paths: the leading dot is part of the NAME, not a `./` prefix.
  write('.github/ci.sh', 'echo a\n');
  write('.idea/workspace.xml', '<a>1</a>\n');
  write('.env', 'K=1\n');
  // Names a shell string cannot carry: a substitution, a backtick and a
  // double quote. Each used to be EXECUTED or to break the quoting outright.
  write('sub$(touch PWNED_SUBST).sh', 'x\n');
  write('tick`touch PWNED_TICK`.sh', 'x\n');
  // A double quote is not a legal Windows filename, so this case is POSIX-only.
  if (!isWindows) write('quote"; touch PWNED_QUOTE; echo ".sh', 'x\n');
  // Non-ASCII, which porcelain escapes as octal in its non-`-z` form.
  write('ünïcode.xml', '<a>1</a>\n');
  write('a\\b.sh', 'x\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');

  write('mod.txt', 'l1\nl2\nCHANGED\nl4\nl5\nl6\nl7\nl8\n');
  write('staged.txt', 's1\ns2\n');
  git('add', 'staged.txt');
  write('untracked.txt', 'u1\nu2\n');
  git('rm', '-q', 'deleted.txt');
  write('sub dir/f.txt', 'sub1\nsub2\n');
  write('.github/ci.sh', 'echo a\necho b\n');
  write('.idea/workspace.xml', '<a>2</a>\n');
  write('.env', 'K=2\n');
  write('sub$(touch PWNED_SUBST).sh', 'y\n');
  write('tick`touch PWNED_TICK`.sh', 'y\n');
  if (!isWindows) write('quote"; touch PWNED_QUOTE; echo ".sh', 'y\n');
  write('ünïcode.xml', '<a>2</a>\n');
  write('a\\b.sh', 'y\n');
});

afterAll(() => {
  removeDir(repo);
});

describe('tracked changes', () => {
  test('an unstaged edit reports M, both counts and its hunk', async () => {
    const result = await fetchWorkingFileDiff(repo, 'mod.txt');
    expect(result.status).toBe('M');
    expect(result.staged).toBe(false);
    expect(result.additions).toBe(1);
    expect(result.deletions).toBe(1);
    expect(result.diff).toContain('--- a/mod.txt');
    expect(result.diff).toContain('+++ b/mod.txt');
    expect(result.diff).toContain('@@ -1,6 +1,6 @@');
    expect(result.diff).toContain('-l3');
    expect(result.diff).toContain('+CHANGED');
    expect(result.oldContent).toBe(EIGHT_LINES);
    expect(result.newContent).toBe('l1\nl2\nCHANGED\nl4\nl5\nl6\nl7\nl8\n');
  });

  test('full context widens the hunk to the whole file', async () => {
    const result = await fetchWorkingFileDiff(repo, 'mod.txt', false, undefined, true);
    expect(result.diff).toContain('@@ -1,8 +1,8 @@');
    expect(result.diff).toContain(' l8');
    expect(result.additions).toBe(1);
    expect(result.deletions).toBe(1);
  });

  test('a staged edit diffs the index against HEAD', async () => {
    const result = await fetchWorkingFileDiff(repo, 'staged.txt', true);
    expect(result.staged).toBe(true);
    expect(result.status).toBe('M');
    expect(result.additions).toBe(1);
    expect(result.deletions).toBe(0);
    expect(result.diff).toContain('@@ -1 +1,2 @@');
    expect(result.diff).toContain('+s2');
  });

  test('a deletion is counted as deletions, not additions', async () => {
    const result = await fetchWorkingFileDiff(repo, 'deleted.txt');
    expect(result.status).toBe('D');
    expect(result.additions).toBe(0);
    expect(result.deletions).toBe(2);
    expect(result.diff).toContain('deleted file mode');
    expect(result.newContent).toBe('');
  });

  test('a path with a space and a parent directory still resolves', async () => {
    const result = await fetchWorkingFileDiff(repo, 'sub dir/f.txt');
    expect(result.file).toBe('sub dir/f.txt');
    expect(result.status).toBe('M');
    expect(result.additions).toBe(1);
    expect(result.diff).toContain('@@ -1 +1,2 @@');
  });

  // A leading dot begins a real NAME in these paths; treating it as a `./`
  // prefix stripped it and pointed every probe at a file that does not exist,
  // so the panel answered "No differences found" for the dot-paths a user is
  // most likely to open a diff for.
  test('a dot-directory keeps its leading dot in the probe and the report', async () => {
    const result = await fetchWorkingFileDiff(repo, '.github/ci.sh');
    expect(result.file).toBe('.github/ci.sh');
    expect(result.status).toBe('M');
    expect(result.additions).toBe(1);
    expect(result.diff).toContain('--- a/.github/ci.sh');
    expect(result.diff).toContain('+++ b/.github/ci.sh');
    expect(result.diff).toContain('+echo b');
  });

  test('a dot-file keeps its leading dot', async () => {
    const result = await fetchWorkingFileDiff(repo, '.env');
    expect(result.file).toBe('.env');
    expect(result.status).toBe('M');
    expect(result.additions).toBe(1);
    expect(result.deletions).toBe(1);
    expect(result.diff).toContain('--- a/.env');
  });

  test('an interior `..` still resolves against the working tree', async () => {
    const result = await fetchWorkingFileDiff(repo, 'sub dir/../.idea/workspace.xml');
    expect(result.status).toBe('M');
    expect(result.additions).toBe(1);
    expect(result.diff).toContain('--- a/.idea/workspace.xml');
  });

  // The probes used to be built as shell strings, so a repo-controlled
  // filename was executed by `sh -c`. Verified before the fix: the marker files
  // these names write appeared in the temp dir.
  test('a filename holding a substitution is diffed, never executed', async () => {
    const name = 'sub$(touch PWNED_SUBST).sh';
    const result = await fetchWorkingFileDiff(repo, name);
    expect(result.status).toBe('M');
    expect(result.additions).toBe(1);
    expect(result.diff).toContain(`+++ b/${name}`);
    expect(fs.existsSync(path.join(process.cwd(), 'PWNED_SUBST'))).toBe(false);
  });

  test('a filename holding a backtick is diffed, never executed', async () => {
    const name = 'tick`touch PWNED_TICK`.sh';
    const result = await fetchWorkingFileDiff(repo, name);
    expect(result.status).toBe('M');
    expect(result.additions).toBe(1);
    expect(result.diff).toContain(`+++ b/${name}`);
    expect(fs.existsSync(path.join(process.cwd(), 'PWNED_TICK'))).toBe(false);
  });

  // A double quote cannot exist in a Windows filename at all, so the fixture's
  // write would throw before the probe could say anything.
  testPosix('a filename holding a double quote keeps its quoting intact', async () => {
    const name = 'quote"; touch PWNED_QUOTE; echo ".sh';
    const result = await fetchWorkingFileDiff(repo, name);
    expect(result.status).toBe('M');
    expect(result.additions).toBe(1);
    // Git quotes the header path itself when it holds a quote or a backslash;
    // what matters is that the diff was produced at all and names the file.
    expect(result.diff).toContain('PWNED_QUOTE');
    expect(result.diff).toContain('@@ -1 +1 @@');
    expect(fs.existsSync(path.join(process.cwd(), 'PWNED_QUOTE'))).toBe(false);
  });

  test('a non-ASCII filename diffs instead of reading as no change', async () => {
    const result = await fetchWorkingFileDiff(repo, 'ünïcode.xml');
    expect(result.file).toBe('ünïcode.xml');
    expect(result.status).toBe('M');
    expect(result.additions).toBe(1);
    expect(result.deletions).toBe(1);
    expect(result.diff).toContain('-<a>1</a>');
    expect(result.diff).toContain('+<a>2</a>');
  });

  // A backslash is an ordinary filename character on POSIX, so it must survive
  // the normalization; only Windows folds it into a separator.
  testPosix('a POSIX filename holding a backslash keeps it', async () => {
    const result = await fetchWorkingFileDiff(repo, 'a\\b.sh');
    expect(result.file).toBe('a\\b.sh');
    expect(result.status).toBe('M');
    expect(result.additions).toBe(1);
    expect(result.diff).toContain('@@ -1 +1 @@');
    expect(result.diff).toContain('-x');
    expect(result.diff).toContain('+y');
  });
});

describe('untracked files', () => {
  test('an untracked file diffs against /dev/null', async () => {
    const result = await fetchWorkingFileDiff(repo, 'untracked.txt');
    expect(result.status).toBe('??');
    expect(result.additions).toBe(2);
    expect(result.deletions).toBe(0);
    expect(result.oldContent).toBe('');
    expect(result.newContent).toBe('u1\nu2\n');
    expect(result.diff).toContain('--- /dev/null');
    expect(result.diff).toContain('@@ -0,0 +1,2 @@');
    expect(result.diff).toContain('+u1');
    expect(result.diff).toContain('+u2');
  });

  test('the untracked status survives a staged request and still yields content', async () => {
    const result = await fetchWorkingFileDiff(repo, 'untracked.txt', true);
    expect(result.status).toBe('??');
    expect(result.staged).toBe(true);
    // The staged diff is empty for an untracked file, so the module
    // synthesizes the diff from the on-disk content: every line gets the
    // status prefix ('+' for '??') and the count includes the trailing
    // empty segment of the trailing newline.
    expect(result.additions).toBe(3);
    expect(result.diff).toContain('--- a/untracked.txt');
    expect(result.diff).toContain('+u2');
  });
});

describe('no-change and fallback paths', () => {
  test('a clean file synthesizes a context-only diff with zero counts', async () => {
    const result = await fetchWorkingFileDiff(repo, 'clean.txt');
    expect(result.status).toBe('M');
    expect(result.additions).toBe(0);
    expect(result.deletions).toBe(0);
    expect(result.diff).toContain('@@ -1,2 +1,2 @@');
    expect(result.diff).not.toContain('+c1');
    expect(result.diff).toContain(' c1');
  });

  test('a requested status is kept when git has nothing to say about the file', async () => {
    const result = await fetchWorkingFileDiff(repo, 'clean.txt', false, 'A');
    expect(result.status).toBe('A');
    expect(result.diff).toContain('+c1');
  });

  test('a path that exists nowhere answers instead of throwing', async () => {
    const result = await fetchWorkingFileDiff(repo, 'nowhere.txt');
    expect(result.file).toBe('nowhere.txt');
    expect(result.additions).toBe(0);
    expect(result.deletions).toBe(0);
    expect(result.diff).toBe('No differences found');
  });

  test('a leading ./ is normalized away from the reported file', async () => {
    const result = await fetchWorkingFileDiff(repo, './mod.txt');
    expect(result.file).toBe('mod.txt');
    expect(result.diff).toContain('--- a/mod.txt');
  });

  test('a diff outside a repository is reported, not thrown', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-gitdiff-plain-'));
    try {
      const result = await fetchWorkingFileDiff(outside, 'anything.txt');
      expect(result.file).toBe('anything.txt');
      expect(result.staged).toBe(false);
      expect(result.additions).toBe(0);
      expect(result.deletions).toBe(0);
      expect(result.diff).toBe('No differences found');
    } finally {
      removeDir(outside);
    }
  });
});
