/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';
import { replaceCell } from '@/shared/lib/fs/grid-edit';

describe('replaceCell', () => {
  test('replaces one cell and leaves the rest of the table alone', () => {
    const rows = [['a', 'b'], ['c', 'd']];
    expect(replaceCell(rows, 1, 0, 'x')).toEqual([['a', 'b'], ['x', 'd']]);
    // The input is not mutated: the grid's rows are a value.
    expect(rows).toEqual([['a', 'b'], ['c', 'd']]);
  });

  test('a cell past a ragged row is padded, not dropped', () => {
    expect(replaceCell([['a'], ['b']], 0, 2, 'z')).toEqual([['a', '', 'z'], ['b']]);
  });

  test('a row that does not exist is left as it was', () => {
    expect(replaceCell([['a']], 5, 0, 'x')).toEqual([['a']]);
  });
});
