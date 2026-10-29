/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The timeline's row arithmetic: measured heights, the mounted window, and the
 * scroll offset a jump lands on.
 *
 * The properties that matter are the ones a wrong answer would show as a broken
 * transcript rather than an error: the spacers must add up to the content
 * height (or the scrollbar lies), the window must always contain the row at the
 * top of the viewport (or the reader sees a blank band), and a jump must land
 * inside the content (or it silently stops short).
 */

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_ROW_HEIGHT,
  ROW_WINDOW_OVERSCAN_PX,
  averageRowHeight,
  layoutTimelineRows,
  rowIndex,
  rowScrollOffset,
  timelineWindow,
} from '@/shared/lib/chat/timeline/row-window';

const ids = (count: number) => Array.from({ length: count }, (_, i) => `m${i}`);

describe('averageRowHeight', () => {
  test('falls back to the default before anything is measured', () => {
    expect(averageRowHeight(new Map())).toBe(DEFAULT_ROW_HEIGHT);
  });

  test('is the mean of the measured rows', () => {
    expect(averageRowHeight(new Map([['a', 100], ['b', 300]]))).toBe(200);
  });
});

describe('layoutTimelineRows', () => {
  test('places each row after the previous one and reports the content height', () => {
    const layout = layoutTimelineRows(ids(3), new Map([['m0', 50], ['m1', 70], ['m2', 30]]));
    expect(Array.from(layout.offsets)).toEqual([0, 50, 120]);
    expect(Array.from(layout.heights)).toEqual([50, 70, 30]);
    expect(layout.total).toBe(150);
  });

  test('an unmeasured row takes the average of the measured ones', () => {
    // m1 has never been mounted: it must not be 0 (a collapsed gap) and it must
    // not be the 120 default when the session's own rows are 300 tall.
    const layout = layoutTimelineRows(ids(3), new Map([['m0', 300], ['m2', 300]]));
    expect(layout.estimate).toBe(300);
    expect(Array.from(layout.heights)).toEqual([300, 300, 300]);
    expect(layout.total).toBe(900);
  });

  test('a zero measurement is not a real height', () => {
    // A row measured while hidden reports 0; using it would collapse the layout.
    const layout = layoutTimelineRows(ids(2), new Map([['m0', 0], ['m1', 80]]));
    expect(layout.heights[0]).toBe(80);
  });

  test('an empty list lays out as zero height', () => {
    const layout = layoutTimelineRows([], new Map());
    expect(layout.total).toBe(0);
    expect(layout.offsets.length).toBe(0);
  });
});

describe('timelineWindow', () => {
  // 40 rows of 100 px: the content is 4 000 px.
  const layout = layoutTimelineRows(ids(40), new Map(ids(40).map((id) => [id, 100])));

  test('an empty layout mounts nothing', () => {
    expect(timelineWindow(layoutTimelineRows([], new Map()), 0, 800)).toEqual({
      start: 0,
      end: 0,
      padTop: 0,
      padBottom: 0,
    });
  });

  test('at the top the first row is mounted and there is no top spacer', () => {
    const win = timelineWindow(layout, 0, 800);
    expect(win.start).toBe(0);
    expect(win.padTop).toBe(0);
    // 800 viewport + 900 overscan = 1 700 px → rows 0..17.
    expect(win.end).toBe(17);
    expect(win.padBottom).toBe(layout.total - win.end * 100);
  });

  test('the spacers plus the mounted rows always add up to the content height', () => {
    for (const top of [0, 350, 1_000, 2_500, 3_999]) {
      const win = timelineWindow(layout, top, 800);
      const mounted = win.end - win.start;
      expect(win.padTop + mounted * 100 + win.padBottom).toBe(layout.total);
    }
  });

  test('the row under the top of the viewport is always mounted', () => {
    for (const top of [0, 99, 100, 101, 2_250, 3_999]) {
      const win = timelineWindow(layout, top, 800);
      const rowAtTop = Math.floor(top / 100);
      expect(win.start).toBeLessThanOrEqual(rowAtTop);
      expect(win.end).toBeGreaterThan(rowAtTop);
    }
  });

  test('at the bottom the last row is mounted and there is no bottom spacer', () => {
    const win = timelineWindow(layout, layout.total - 800, 800);
    expect(win.end).toBe(40);
    expect(win.padBottom).toBe(0);
  });

  test('a rubber-band negative offset is measured from the top', () => {
    expect(timelineWindow(layout, -400, 800)).toEqual(timelineWindow(layout, 0, 800));
  });

  test('the overscan is what decides how much is mounted beyond the viewport', () => {
    const tight = timelineWindow(layout, 1_000, 800, 0);
    const loose = timelineWindow(layout, 1_000, 800, ROW_WINDOW_OVERSCAN_PX);
    expect(tight.end - tight.start).toBeLessThan(loose.end - loose.start);
    expect(loose.start).toBeLessThan(tight.start);
  });

  test('one row taller than the viewport is still mounted whole', () => {
    const tall = layoutTimelineRows(ids(3), new Map([['m0', 100], ['m1', 5_000], ['m2', 100]]));
    const win = timelineWindow(tall, 2_000, 800);
    expect(win.start).toBe(1);
    expect(win.end).toBe(2);
  });
});

describe('rowScrollOffset', () => {
  const layout = layoutTimelineRows(ids(40), new Map(ids(40).map((id) => [id, 100])));

  test('centres the row in the viewport', () => {
    // Row 20 spans 2 000..2 100; centring a 100 px row in 800 px puts it at
    // 2 000 - 350 = 1 650.
    expect(rowScrollOffset(layout, 20, 800)).toBe(1_650);
  });

  test('clamps at the head and the tail of the content', () => {
    expect(rowScrollOffset(layout, 0, 800)).toBe(0);
    expect(rowScrollOffset(layout, 39, 800)).toBe(layout.total - 800);
  });

  test('an index outside the list is the top', () => {
    expect(rowScrollOffset(layout, -1, 800)).toBe(0);
    expect(rowScrollOffset(layout, 40, 800)).toBe(0);
  });
});

describe('rowIndex', () => {
  test('finds the newest row with that id', () => {
    // An optimistic send and its reconciled echo can share a display; the row
    // the reader is looking at is the last one.
    expect(rowIndex(['a', 'b', 'a'], 'a')).toBe(2);
    expect(rowIndex(['a', 'b'], 'c')).toBe(-1);
  });
});
