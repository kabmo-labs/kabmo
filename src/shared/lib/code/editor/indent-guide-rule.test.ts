/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What an indent guide means.
 *
 * Three rules, and each is a case a naive version gets wrong: one guide per indented
 * line (not one per column), none on a blank line (its whitespace is trailing noise),
 * and none past the column cap (a minified file is one huge line).
 */

import { describe, expect, test } from 'bun:test';

import { MAX_GUIDE_COLUMNS, guideColumn, guideColumns } from '@/shared/lib/code/editor/indent-guide-rule';

describe('guideColumn', () => {
  test('an indented line gets one guide, at the first level', () => {
    expect(guideColumn('  const a = 1;', 2)).toBe(2);
    expect(guideColumn('    const a = 1;', 2)).toBe(2);
    expect(guideColumn('    const a = 1;', 4)).toBe(4);
  });

  test('a line at column 0 gets none', () => {
    expect(guideColumn('const a = 1;', 2)).toBeNull();
    expect(guideColumn(' const a = 1;', 2)).toBeNull();
  });

  test('a blank line gets none, whatever its whitespace', () => {
    // Its indentation is trailing whitespace, not structure — a guide there would
    // draw a rule through the gap that makes a block readable.
    expect(guideColumn('', 2)).toBeNull();
    expect(guideColumn('    ', 2)).toBeNull();
    expect(guideColumn('\t', 2)).toBeNull();
  });

  test('a tab counts as one column of indent', () => {
    expect(guideColumn('\tconst a = 1;', 1)).toBe(1);
    expect(guideColumn('\tconst a = 1;', 2)).toBeNull();
  });

  test('a line past the cap gets none, because counting it is work nobody can see', () => {
    const huge = ' '.repeat(MAX_GUIDE_COLUMNS + 1) + 'x';
    expect(guideColumn(huge, 2)).toBeNull();
  });

  test('a unit of zero or less answers null rather than dividing by nothing', () => {
    expect(guideColumn('  x', 0)).toBeNull();
    expect(guideColumn('  x', -2)).toBeNull();
  });
});

describe('guideColumns', () => {
  test('reports the index and column for each line that gets one', () => {
    expect(guideColumns(['a', '  b', '', '    c'], 2)).toEqual([
      { index: 1, column: 2 },
      { index: 3, column: 2 },
    ]);
  });

  test('a document with no indentation reports nothing', () => {
    expect(guideColumns(['a', 'b'], 2)).toEqual([]);
  });
});
