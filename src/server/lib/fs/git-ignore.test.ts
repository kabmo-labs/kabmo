/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `git check-ignore` as the Files panel's dim rule.
 *
 * Every case drives a REAL git against a temp tree: the question is what git
 * refuses to track, so a hand-written pattern matcher would pin a second
 * implementation instead of the authority. What is pinned is the scope of the
 * answer — per-directory `.gitignore`, negation and directory patterns, the
 * "not a repository" (exit 128) non-answer, the 5 s memo, and the ceiling that
 * stops an enclosing repository from answering for a root it does not own.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectIgnoredPaths } from '@/server/lib/fs/git-ignore';

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `kabmo-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe('collectIgnoredPaths', () => {
  test('no paths means no git call and an empty answer', async () => {
    expect(await collectIgnoredPaths(tempDir('ignore'), [])).toEqual(new Set());
  });

  test('patterns, negation and directory patterns match what git refuses', async () => {
    const dir = tempDir('ignore');
    execFileSync('git', ['init', '-q'], { cwd: dir });
    writeFileSync(join(dir, '.gitignore'), 'build/\n*.log\n!keep.log\n');
    mkdirSync(join(dir, 'build'), { recursive: true });
    writeFileSync(join(dir, 'build', 'x.txt'), '');
    writeFileSync(join(dir, 'a.log'), '');
    writeFileSync(join(dir, 'keep.log'), '');
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'main.ts'), '');

    const ignored = await collectIgnoredPaths(dir, ['build/x.txt', 'a.log', 'keep.log', 'src/main.ts']);
    expect(ignored.has('build/x.txt')).toBe(true); // directory pattern
    expect(ignored.has('a.log')).toBe(true); // extension pattern
    expect(ignored.has('keep.log')).toBe(false); // negated
    expect(ignored.has('src/main.ts')).toBe(false);
  });

  test('an enclosing repository above the browsed root does not answer for it', async () => {
    const outer = tempDir('ignore-nested');
    execFileSync('git', ['init', '-q'], { cwd: outer });
    writeFileSync(join(outer, '.gitignore'), 'projects/\n');
    const root = join(outer, 'projects');
    mkdirSync(join(root, 'child-one'), { recursive: true });
    mkdirSync(join(root, 'child-two'), { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: join(root, 'child-one') });

    // `projects/` is ignored by the repository ABOVE the browsed root — the
    // folder-of-repositories layout (`projects/<name>/.git`) that Kabmo opens
    // as a workspace. Every row used to come back dimmed from those rules.
    expect(await collectIgnoredPaths(root, ['child-one', 'child-two'])).toEqual(new Set());

    // The root's OWN repository still answers: the ceiling is its parent, not
    // the root itself (git treats a ceiling equal to the start as no ceiling).
    writeFileSync(join(root, 'child-one', '.gitignore'), '*.log\n');
    writeFileSync(join(root, 'child-one', 'a.log'), '');
    expect((await collectIgnoredPaths(join(root, 'child-one'), ['a.log'])).has('a.log')).toBe(true);
  });

  test('a non-repository (exit 128) is not cached as an answer', async () => {
    const dir = tempDir('ignore');
    writeFileSync(join(dir, 'a.log'), '');
    expect(await collectIgnoredPaths(dir, ['a.log'])).toEqual(new Set());
    // Same path, now inside a repository with a rule that matches it: had the
    // 128 answer been cached, this would still be empty.
    execFileSync('git', ['init', '-q'], { cwd: dir });
    writeFileSync(join(dir, '.gitignore'), '*.log\n');
    expect((await collectIgnoredPaths(dir, ['a.log'])).has('a.log')).toBe(true);
  });

  test('an answer is cached for the TTL, so a just-edited rule is briefly stale', async () => {
    const dir = tempDir('ignore');
    execFileSync('git', ['init', '-q'], { cwd: dir });
    writeFileSync(join(dir, '.gitignore'), '*.log\n');
    writeFileSync(join(dir, 'a.log'), '');
    expect((await collectIgnoredPaths(dir, ['a.log'])).has('a.log')).toBe(true);
    rmSync(join(dir, '.gitignore'));
    // Within the 5s TTL the memoized "ignored" answer is still returned.
    expect((await collectIgnoredPaths(dir, ['a.log'])).has('a.log')).toBe(true);
  });
});
