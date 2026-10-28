/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The search result list's layout arithmetic.
 *
 * The panel paints only the rows a viewport can show, so the row sequence has
 * to be addressable by index and its geometry has to be exact — an estimated
 * height makes the scrollbar drift and a jump land on the wrong line. These are
 * the cases that would break silently on screen: a group boundary, the gap
 * after the last hit of a file, a scroll past either end, and a range that is
 * entirely between two rows.
 */

import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_SEARCH_ROW_METRICS,
  SEARCH_ROW_GAPS,
  buildSearchRows,
  layoutSearchRows,
  searchRowHeight,
  searchWindow,
} from '@/shared/lib/fs/search-list';

const metrics = { headerBox: 16, hitBox: 20 };
const H = metrics.headerBox + SEARCH_ROW_GAPS.header; // 20
const HIT = metrics.hitBox + SEARCH_ROW_GAPS.hit; // 24
const HIT_LAST = metrics.hitBox + SEARCH_ROW_GAPS.group; // 36

function group(file: string, lines: number[]) {
  return { file, results: lines.map((line) => ({ file, line, content: `line ${line}` })) };
}

describe('buildSearchRows', () => {
  test('a file header precedes its hits, in stream order', () => {
    const rows = buildSearchRows([group('a.ts', [1, 2])]);

    expect(rows.map((r) => r.kind)).toEqual(['group', 'hit', 'hit']);
    expect(rows[1]).toMatchObject({ kind: 'hit', file: 'a.ts', last: false });
    expect(rows[2]).toMatchObject({ kind: 'hit', file: 'a.ts', last: true });
  });

  test('only the last hit of a file is marked, across several files', () => {
    const rows = buildSearchRows([group('a.ts', [1]), group('b.ts', [7, 8])]);

    expect(rows.map((r) => (r.kind === 'hit' ? r.last : null))).toEqual([null, true, null, false, true]);
  });

  test('an empty list flattens to nothing', () => {
    expect(buildSearchRows([])).toEqual([]);
  });
});

describe('searchRowHeight', () => {
  test('a header carries the gap below it', () => {
    expect(searchRowHeight({ kind: 'group', file: 'a', count: 1 }, metrics)).toBe(H);
  });

  test('a mid-file hit carries the small gap, the last one the file gap', () => {
    const result = { file: 'a', line: 1, content: 'x' };

    expect(searchRowHeight({ kind: 'hit', file: 'a', result, last: false }, metrics)).toBe(HIT);
    expect(searchRowHeight({ kind: 'hit', file: 'a', result, last: true }, metrics)).toBe(HIT_LAST);
  });
});

describe('layoutSearchRows', () => {
  test('offsets are cumulative and total is the last row end', () => {
    const rows = buildSearchRows([group('a.ts', [1, 2])]);
    const { offsets, heights, total } = layoutSearchRows(rows, metrics);

    expect(offsets).toEqual([0, H, H + HIT]);
    expect(heights).toEqual([H, HIT, HIT_LAST]);
    expect(total).toBe(H + HIT + HIT_LAST);
  });

  test('the total matches the sum of the heights for a multi-file list', () => {
    const rows = buildSearchRows([group('a.ts', [1]), group('b.ts', [2, 3])]);
    const { heights, total } = layoutSearchRows(rows, metrics);

    expect(total).toBe(heights.reduce((sum, h) => sum + h, 0));
  });
});

describe('searchWindow', () => {
  const rows = buildSearchRows([group('a.ts', [1, 2, 3]), group('b.ts', [4])]);
  const { offsets, heights } = layoutSearchRows(rows, metrics);

  test('an empty list yields an empty window', () => {
    expect(searchWindow([], [], 0, 500)).toEqual({ start: 0, end: 0 });
  });

  test('without overscan the window is exactly the visible rows', () => {
    // Rows: [0,20) header, [20,44) hit, [44,68) hit, [68,104) last hit, [104,124) header, [124,160) hit.
    expect(searchWindow(offsets, heights, 0, 20, 0)).toEqual({ start: 0, end: 1 });
    expect(searchWindow(offsets, heights, 20, 24, 0)).toEqual({ start: 1, end: 2 });
    // A viewport starting mid-row still mounts the row it covers.
    expect(searchWindow(offsets, heights, 30, 20, 0)).toEqual({ start: 1, end: 3 });
  });

  test('a scroll past the end clamps to the last row', () => {
    const window = searchWindow(offsets, heights, 100000, 500, 0);

    expect(window.start).toBe(rows.length - 1);
    expect(window.end).toBe(rows.length);
  });

  test('a negative scrollTop still starts at the first row', () => {
    expect(searchWindow(offsets, heights, -500, 100, 0).start).toBe(0);
  });

  test('overscan widens the range on both sides', () => {
    const tight = searchWindow(offsets, heights, 44, 24, 0);
    const wide = searchWindow(offsets, heights, 44, 24, 20);

    expect(wide.start).toBeLessThanOrEqual(tight.start);
    expect(wide.end).toBeGreaterThanOrEqual(tight.end);
  });

  test('the whole list is covered by scrolling through it', () => {
    const seen = new Set<number>();
    for (let top = 0; top < 160; top += 24) {
      const { start, end } = searchWindow(offsets, heights, top, 24, 0);
      for (let i = start; i < end; i++) seen.add(i);
    }

    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('DEFAULT_SEARCH_ROW_METRICS', () => {
  test('is a usable non-zero layout before measurement', () => {
    expect(DEFAULT_SEARCH_ROW_METRICS.headerBox).toBeGreaterThan(0);
    expect(DEFAULT_SEARCH_ROW_METRICS.hitBox).toBeGreaterThan(0);
  });
});
