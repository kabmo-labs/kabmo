/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The search row's replace preview split.
 *
 * The row shows the line struck through and rewritten, so the segment list IS
 * what the user reads. The cases that matter are the ones a naive splice gets
 * wrong: a match in the middle of a line (plain runs either side), two matches
 * on one line (each gets its own insertion), and a malformed range that must be
 * skipped rather than allowed to duplicate text.
 */

import { describe, expect, test } from 'bun:test';

import { replacePreviewSegments } from '@/shared/lib/fs/search-row';

describe('replacePreviewSegments', () => {
  test('splits a single mid-line match into plain, removed and inserted', () => {
    expect(replacePreviewSegments('const alpha = 1;', [{ start: 6, end: 11 }], 'beta')).toEqual([
      { text: 'const ', kind: 'plain' },
      { text: 'alpha', kind: 'removed' },
      { text: 'beta', kind: 'inserted' },
      { text: ' = 1;', kind: 'plain' },
    ]);
  });

  test('gives every match on a line its own insertion', () => {
    expect(replacePreviewSegments('a a', [{ start: 0, end: 1 }, { start: 2, end: 3 }], 'b')).toEqual([
      { text: 'a', kind: 'removed' },
      { text: 'b', kind: 'inserted' },
      { text: ' ', kind: 'plain' },
      { text: 'a', kind: 'removed' },
      { text: 'b', kind: 'inserted' },
    ]);
  });

  test('an empty replacement removes without inserting', () => {
    expect(replacePreviewSegments('alpha', [{ start: 0, end: 5 }], '')).toEqual([
      { text: 'alpha', kind: 'removed' },
    ]);
  });

  test('skips a range that overlaps the previous one', () => {
    // A malformed list must not make the row render a line that is not the file's.
    const segments = replacePreviewSegments('alpha', [{ start: 0, end: 3 }, { start: 2, end: 5 }], 'x');

    expect(segments).toEqual([
      { text: 'alp', kind: 'removed' },
      { text: 'x', kind: 'inserted' },
      { text: 'ha', kind: 'plain' },
    ]);
  });

  test('skips a range past the end of the text', () => {
    expect(replacePreviewSegments('alpha', [{ start: 3, end: 99 }], 'x')).toEqual([
      { text: 'alpha', kind: 'plain' },
    ]);
  });

  test('no ranges is one plain run', () => {
    expect(replacePreviewSegments('alpha', [], 'x')).toEqual([{ text: 'alpha', kind: 'plain' }]);
  });
});
