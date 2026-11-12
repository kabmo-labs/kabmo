/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The grid's selection arithmetic and its clipboard payload.
 *
 * Both fail silently when wrong: an off-by-one range copies the wrong block,
 * and a payload that is not quoted correctly pastes as one column (or as extra
 * rows) in Excel — the exact round trip the copy exists for.
 */

import { describe, expect, test } from 'bun:test';
import {
  cellAddress,
  cellRange,
  clampCell,
  columnLabel,
  moveCell,
  rangeAddress,
  rangeColumnCount,
  rangeContains,
  rangeRowCount,
  rangeToTsv,
  selectAllRange,
} from '@/shared/lib/fs/grid-selection';

describe('columnLabel', () => {
  test('the first 26 columns are A..Z', () => {
    expect(columnLabel(0)).toBe('A');
    expect(columnLabel(25)).toBe('Z');
  });

  // Bijective base-26: there is no zero digit, so 26 is AA and not BA.
  test('past Z the label carries', () => {
    expect(columnLabel(26)).toBe('AA');
    expect(columnLabel(27)).toBe('AB');
    expect(columnLabel(51)).toBe('AZ');
    expect(columnLabel(52)).toBe('BA');
    expect(columnLabel(701)).toBe('ZZ');
    expect(columnLabel(702)).toBe('AAA');
  });
});

describe('addresses', () => {
  test('a cell is its letter and its one-based row', () => {
    expect(cellAddress({ row: 0, col: 0 })).toBe('A1');
    expect(cellAddress({ row: 4, col: 2 })).toBe('C5');
  });

  test('a range names both corners, and a single cell names one', () => {
    expect(rangeAddress({ top: 1, left: 1, bottom: 4, right: 3 })).toBe('B2:D5');
    expect(rangeAddress({ top: 2, left: 2, bottom: 2, right: 2 })).toBe('C3');
  });
});

describe('cellRange', () => {
  test('the rectangle is the same whichever corner came first', () => {
    const forward = cellRange({ row: 1, col: 1 }, { row: 4, col: 3 });
    const backward = cellRange({ row: 4, col: 3 }, { row: 1, col: 1 });
    expect(forward).toEqual({ top: 1, left: 1, bottom: 4, right: 3 });
    expect(backward).toEqual(forward);
  });

  test('a single cell is a 1x1 range', () => {
    const range = cellRange({ row: 2, col: 2 }, { row: 2, col: 2 });
    expect(rangeRowCount(range)).toBe(1);
    expect(rangeColumnCount(range)).toBe(1);
  });

  test('containment is inclusive on every edge', () => {
    const range = { top: 1, left: 1, bottom: 3, right: 2 };
    expect(rangeContains(range, 1, 1)).toBe(true);
    expect(rangeContains(range, 3, 2)).toBe(true);
    expect(rangeContains(range, 0, 1)).toBe(false);
    expect(rangeContains(range, 1, 3)).toBe(false);
  });
});

describe('clampCell and moveCell', () => {
  test('a cell outside the grid is pulled to the nearest edge', () => {
    expect(clampCell({ row: -3, col: -1 }, 5, 4)).toEqual({ row: 0, col: 0 });
    expect(clampCell({ row: 99, col: 99 }, 5, 4)).toEqual({ row: 4, col: 3 });
  });

  test('a move stops at the edge instead of wrapping', () => {
    expect(moveCell({ row: 0, col: 0 }, -1, 0, 5, 4)).toEqual({ row: 0, col: 0 });
    expect(moveCell({ row: 4, col: 3 }, 1, 1, 5, 4)).toEqual({ row: 4, col: 3 });
    expect(moveCell({ row: 2, col: 2 }, 1, -1, 5, 4)).toEqual({ row: 3, col: 1 });
  });

  test('an empty grid clamps to its only possible cell', () => {
    expect(clampCell({ row: 3, col: 3 }, 0, 0)).toEqual({ row: 0, col: 0 });
  });
});

describe('selectAllRange', () => {
  test('covers every cell', () => {
    expect(selectAllRange(3, 2)).toEqual({ top: 0, left: 0, bottom: 2, right: 1 });
  });

  test('an empty grid has nothing to select', () => {
    expect(selectAllRange(0, 4)).toBeNull();
    expect(selectAllRange(4, 0)).toBeNull();
  });
});

describe('rangeToTsv', () => {
  const rows = [
    ['Name', 'Qty', 'Note'],
    ['Widget', '3', 'plain'],
    ['Gadget', '1', 'has, comma'],
  ];

  test('a block is tab-separated with CRLF between rows', () => {
    expect(rangeToTsv(rows, { top: 0, left: 0, bottom: 1, right: 1 })).toBe('Name\tQty\r\nWidget\t3');
  });

  test('a single cell is one field', () => {
    expect(rangeToTsv(rows, { top: 2, left: 2, bottom: 2, right: 2 })).toBe('has, comma');
  });

  // The failure this prevents: a cell holding a tab or a newline splits the
  // pasted block into extra columns or rows.
  test('a field with a tab, a newline or a quote is quoted and its quotes doubled', () => {
    const tricky = [['a\tb', 'line\nbreak', 'say "hi"']];
    expect(rangeToTsv(tricky, { top: 0, left: 0, bottom: 0, right: 2 })).toBe(
      '"a\tb"\t"line\nbreak"\t"say ""hi"""',
    );
  });

  test('a ragged row keeps the block shape with empty fields', () => {
    const ragged = [['a'], ['b', 'c']];
    expect(rangeToTsv(ragged, { top: 0, left: 0, bottom: 1, right: 1 })).toBe('a\t\r\nb\tc');
  });
});
