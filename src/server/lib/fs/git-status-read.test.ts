/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The working-tree status read behind the Source Control panel.
 *
 * The load-bearing part is the porcelain DIALECT: `-z` is the only lossless
 * form. The non-`-z` form quotes any path holding a space, a quote or a
 * backslash and octal-escapes its non-ASCII bytes, and no decode reverses that
 * — `JSON.parse` turns `"\303\274n"` into the literal text `\303\274`, a path
 * that does not exist, so the panel listed a filename whose diff then read
 * "No differences found". These tests drive a real repository holding those
 * names and pin the file, the status, the staged flag, and the rename shape.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { testPosix } from '@/test-support/platform';
import { parsePorcelainZ } from '@/server/lib/fs/git-run';
import { readGitStatus } from '@/server/lib/fs/git-status-read';
import { removeDir } from '@/test-support/remove-dir';

const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-status-'));

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

beforeAll(() => {
  git('init', '-q', '-b', 'main');
  // Pin the line ending: a Windows host defaults `core.autocrlf` to true, which
  // rewrites every checked-out file to CRLF.
  git('config', 'core.autocrlf', 'false');
  git('config', 'core.eol', 'lf');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  write('plain.sh', 'p\n');
  write('with space.sh', 's\n');
  write('ünïcode.xml', '<a>1</a>\n');
  write('a\\b.sh', 'b\n');
  write('to-rename.txt', 'r\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');

  write('plain.sh', 'p2\n');
  write('with space.sh', 's2\n');
  write('ünïcode.xml', '<a>2</a>\n');
  write('a\\b.sh', 'b2\n');
  write('untracked.sh', 'u\n');
  git('mv', 'to-rename.txt', 'renamed.txt');
});

afterAll(() => {
  removeDir(repo);
});

describe('parsePorcelainZ', () => {
  test('splits on NUL, not on newline', () => {
    const rows = parsePorcelainZ(' M a.sh\0?? b.xml\0');
    expect(rows.map((r) => r.file)).toEqual(['a.sh', 'b.xml']);
    expect(rows[0].status).toBe(' M');
    expect(rows[1].staged).toBe(false);
  });

  test('unwraps a rename from its own record, keeping the NEW path', () => {
    // A rename spends two records: the new path, then the old one.
    const rows = parsePorcelainZ('R  new.txt\0old.txt\0 M other.txt\0');
    expect(rows).toHaveLength(2);
    expect(rows[0].file).toBe('new.txt');
    expect(rows[0].staged).toBe(true);
    expect(rows[1].file).toBe('other.txt');
  });

  test('a copy is unwrapped the same way', () => {
    const rows = parsePorcelainZ('C  copy.txt\0source.txt\0');
    expect(rows).toHaveLength(1);
    expect(rows[0].file).toBe('copy.txt');
  });

  test('an empty listing yields no rows', () => {
    expect(parsePorcelainZ('')).toEqual([]);
    expect(parsePorcelainZ('\0')).toEqual([]);
  });
});

describe('readGitStatus', () => {
  test('reports every changed file with its path intact', async () => {
    const status = await readGitStatus(repo);
    const files = status.changes.map((c) => c.file).sort();
    expect(files).toContain('plain.sh');
    expect(files).toContain('with space.sh');
    expect(files).toContain('untracked.sh');
    expect(status.isRepo).toBe(true);
  });

  /**
   * The panel decides between its normal chrome and the init state from this
   * flag, so the not-a-repository answer must be POSITIVE: it used to be an empty
   * change list on branch `main`, which reads exactly like a clean tree (the
   * Source Control panel said "No changes found." and every control it drew
   * failed with git's own refusal).
   */
  test('a folder outside every repository answers isRepo false, with git’s reason', async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-no-repo-'));
    try {
      const status = await readGitStatus(plain);
      expect(status.isRepo).toBe(false);
      expect(status.error ?? '').toMatch(/not a git repository/i);
      expect(status.changes).toEqual([]);
    } finally {
      removeDir(plain);
    }
  });

  // The bug this dialect exists to prevent: porcelain's default form escapes
  // these, and a decode of the escaped text names a file that is not there.
  test('a non-ASCII filename arrives as its real bytes, not an octal escape', async () => {
    const status = await readGitStatus(repo);
    const hit = status.changes.find((c) => c.file.includes('code.xml'));
    expect(hit?.file).toBe('ünïcode.xml');
  });

  // `\` is a path separator on Windows, so a file literally named `a\b.sh` cannot
  // exist there to be reported back unquoted; the quoting it exercises is a
  // POSIX git behaviour.
  testPosix('a filename holding a backslash arrives unquoted', async () => {
    const status = await readGitStatus(repo);
    const hit = status.changes.find((c) => c.file.includes('b.sh'));
    expect(hit?.file).toBe('a\\b.sh');
  });

  test('a filename holding a space arrives unquoted', async () => {
    const status = await readGitStatus(repo);
    const hit = status.changes.find((c) => c.file === 'with space.sh');
    expect(hit).toBeDefined();
    expect(hit?.status.trim()).toBe('M');
  });

  test('a rename is reported under its new path, staged', async () => {
    const status = await readGitStatus(repo);
    const hit = status.changes.find((c) => c.file === 'renamed.txt');
    expect(hit).toBeDefined();
    expect(hit?.status[0]).toBe('R');
    expect(hit?.staged).toBe(true);
    // The old path is not a file the working tree still has.
    expect(status.changes.some((c) => c.file === 'to-rename.txt')).toBe(false);
  });
});
