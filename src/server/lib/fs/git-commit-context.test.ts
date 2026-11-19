/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { limitCommitContext, readCommitContext } from '@/server/lib/fs/git-commit-context';
import { removeDir } from '@/test-support/remove-dir';

const dirs: string[] = [];

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync({ cmd: ['git', ...args], cwd });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString().trim();
}

function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-commit-context-'));
  dirs.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'core.autocrlf', 'false');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(dir, 'base.txt'), 'base\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

afterAll(() => {
  for (const dir of dirs) removeDir(dir);
});

describe('readCommitContext', () => {
  test('reads the staged set only, never the unstaged or untracked work', async () => {
    const dir = makeRepo();
    fs.writeFileSync(path.join(dir, 'staged.txt'), 'staged\n');
    git(dir, 'add', 'staged.txt');
    fs.writeFileSync(path.join(dir, 'unstaged.txt'), 'unstaged\n');

    const context = await readCommitContext(dir, false);

    expect(context.files).toEqual(['staged.txt']);
    expect(context.diff).toContain('+staged');
    expect(context.diff).not.toContain('unstaged');
    expect(context.recentCommits).toEqual(['base']);
    expect(context.branch).toBe('main');
  });

  test('an amend with nothing staged describes the commit being rewritten', async () => {
    const dir = makeRepo();

    const plain = await readCommitContext(dir, false);
    expect(plain.files).toEqual([]);
    expect(plain.diff).toBe('');

    const amend = await readCommitContext(dir, true);
    expect(amend.files).toEqual(['base.txt']);
    expect(amend.diff).toContain('+base');
    expect(amend.amend).toBe(true);
  });

  test('a staged change wins over the amend fallback', async () => {
    const dir = makeRepo();
    fs.writeFileSync(path.join(dir, 'next.txt'), 'next\n');
    git(dir, 'add', 'next.txt');

    const context = await readCommitContext(dir, true);
    expect(context.files).toEqual(['next.txt']);
    expect(context.diff).toContain('+next');
    expect(context.diff).not.toContain('+base');
  });
});

describe('limitCommitContext', () => {
  test('caps the file list and the diff, and says so', () => {
    const context = {
      branch: 'main',
      files: Array.from({ length: 31 }, (_, index) => `file-${index}.ts`),
      diff: 'x'.repeat(130_000),
      recentCommits: [],
      truncated: false,
      amend: false,
    };

    const limited = limitCommitContext(context);

    expect(limited.files).toHaveLength(30);
    expect(limited.diff.length).toBeLessThan(130_000);
    expect(limited.diff).toContain('[remaining diff truncated]');
    expect(limited.truncated).toBe(true);
  });

  test('leaves a small context untouched', () => {
    const context = {
      branch: 'main',
      files: ['a.ts'],
      diff: '+a',
      recentCommits: ['base'],
      truncated: false,
      amend: false,
    };
    expect(limitCommitContext(context)).toEqual(context);
  });
});
