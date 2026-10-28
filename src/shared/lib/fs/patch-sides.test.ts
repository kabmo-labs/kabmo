/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A unified patch → the two documents it compares.
 *
 * What this pins is the shape a chat tool card depends on: a card has a PATCH
 * and no files, and it draws the same merge surface the diff panel does — so the
 * sides it hands over must be exactly what the patch says they were. A context
 * row belongs to both, a `-` row only to the original, a `+` row only to the new
 * one; everything else (the `diff --git` header, `index`, `---`/`+++`, mode and
 * rename lines, the "No newline" marker) is metadata and must not appear in
 * either document.
 */

import { describe, expect, test } from 'bun:test';

import { patchSides } from '@/shared/lib/fs/patch-sides';

const GIT_DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +1,3 @@',
  ' const one = 1;',
  '-const two = 2;',
  '+const two = 22;',
  ' const three = 3;',
  '',
].join('\n');

describe('patchSides', () => {
  test('splits a git diff into the documents it compares', () => {
    const sides = patchSides(GIT_DIFF);

    expect(sides.original).toBe('const one = 1;\nconst two = 2;\nconst three = 3;');
    expect(sides.next).toBe('const one = 1;\nconst two = 22;\nconst three = 3;');
    expect(sides.additions).toBe(1);
    expect(sides.deletions).toBe(1);
    expect(sides.hasHunk).toBe(true);
  });

  test('keeps the header lines out of both documents', () => {
    // A `--- a/x` header would otherwise land in the original as `-- a/x`, and
    // the merge view would draw a chunk that is not a change.
    const sides = patchSides(GIT_DIFF);
    for (const line of ['diff --git', 'index ', '--- a/', '+++ b/']) {
      expect(sides.original.includes(line)).toBe(false);
      expect(sides.next.includes(line)).toBe(false);
    }
  });

  test('a new file has an empty original and the whole new document', () => {
    const sides = patchSides(['@@ -0,0 +1,2 @@', '+alpha', '+beta'].join('\n'));

    expect(sides.original).toBe('');
    expect(sides.next).toBe('alpha\nbeta');
    expect(sides.additions).toBe(2);
    expect(sides.deletions).toBe(0);
  });

  test('a deleted file is the mirror image', () => {
    const sides = patchSides(['@@ -1,1 +0,0 @@', '-gone'].join('\n'));

    expect(sides.original).toBe('gone');
    expect(sides.next).toBe('');
    expect(sides.deletions).toBe(1);
  });

  test('a header-only patch has no rows, so the caller can fall back to text', () => {
    const sides = patchSides('--- a/x\n+++ b/x\n');

    expect(sides.rows).toBe(0);
    expect(sides.hasHunk).toBe(false);
  });

  test('an empty patch is the empty answer, not a one-line document', () => {
    expect(patchSides('')).toEqual({ original: '', next: '', additions: 0, deletions: 0, rows: 0, hasHunk: false });
    expect(patchSides('   \n')).toEqual({ original: '', next: '', additions: 0, deletions: 0, rows: 0, hasHunk: false });
  });

  test('counts rows without the blank line a trailing newline leaves behind', () => {
    const sides = patchSides(['@@ -1 +1 @@', '-a', '+b'].join('\n'));

    expect(sides.rows).toBe(2);
  });

  test('a hunk starting mid-file keeps its real line numbers', () => {
    // Without the padding the change would be line 1 of the rebuilt document,
    // and the card's gutter would name a line the file does not have it on.
    const sides = patchSides(['@@ -43,2 +43,2 @@', ' context', '-old', '+new'].join('\n'));

    expect(sides.original.split('\n')).toHaveLength(44);
    expect(sides.original.split('\n')[42]).toBe('context');
    expect(sides.original.split('\n')[43]).toBe('old');
    expect(sides.next.split('\n')[43]).toBe('new');
  });

  test('the gap between two hunks is restored from their own headers', () => {
    const sides = patchSides(
      ['@@ -2,1 +2,1 @@', '-a', '+b', '@@ -10,1 +10,1 @@', '-c', '+d'].join('\n'),
    );

    // Line 2 is the first change, line 10 the second, and everything between is
    // unchanged content the patch did not carry.
    const original = sides.original.split('\n');
    expect(original[1]).toBe('a');
    expect(original[9]).toBe('c');
    expect(original).toHaveLength(10);
  });
});
