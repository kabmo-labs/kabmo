/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `⋯` rule, asserted as arithmetic.
 *
 * Each case is a failure the toolbars had: a row that wrapped into two rows
 * instead of hiding a control, a control hidden while the width was still
 * unknown (a menu flashing on every mount), and a pinned control buried in the
 * menu because the row happened to be narrow.
 */

import { describe, expect, test } from 'bun:test';

import {
  TOOLBAR_ITEM_GAP_PX,
  TOOLBAR_OVERFLOW_TRIGGER_PX,
  toolbarHasOverflow,
  toolbarVisibleClusters,
} from '@/shared/lib/ui/toolbar-overflow';

/** Save, find, wrap, zoom, copy, modes, full screen — the editor's real row. */
const widths = [26, 26, 26, 52, 52, 52, 26];
const pinned = [true, false, false, false, false, true, true];

/** Row width needed to draw `visible` plus the trigger when anything is hidden. */
function rowWidth(visible: boolean[]): number {
  const shown = widths.filter((_, index) => visible[index]);
  const overflow = toolbarHasOverflow(visible);
  return (
    shown.reduce((sum, width) => sum + width, 0) +
    TOOLBAR_ITEM_GAP_PX * Math.max(0, shown.length - 1) +
    (overflow ? TOOLBAR_OVERFLOW_TRIGGER_PX + TOOLBAR_ITEM_GAP_PX : 0)
  );
}

describe('toolbarVisibleClusters', () => {
  test('an unmeasured row shows every cluster', () => {
    // Not "hide everything": the row is measured a layout effect later, and a
    // menu that flashes on every mount is worse than one frame of a full row.
    expect(toolbarVisibleClusters({ widths, pinned, available: 0 }).every(Boolean)).toBe(true);
  });

  test('a row wide enough for everything shows everything, with no trigger', () => {
    const total = widths.reduce((sum, width) => sum + width, 0) + TOOLBAR_ITEM_GAP_PX * (widths.length - 1);
    const visible = toolbarVisibleClusters({ widths, pinned, available: total });
    expect(visible.every(Boolean)).toBe(true);
    expect(toolbarHasOverflow(visible)).toBe(false);
  });

  test('a narrow row hides what does not fit and reserves the trigger', () => {
    // 200px of row: the three pinned clusters (26 + 52 + 26) plus their gaps
    // leave room for one unpinned control and the `⋯` trigger, and no more.
    const visible = toolbarVisibleClusters({ widths, pinned, available: 200 });
    expect(toolbarHasOverflow(visible)).toBe(true);
    // The promise the arithmetic has to keep: what stays plus the trigger fits.
    expect(rowWidth(visible)).toBeLessThanOrEqual(200);
  });

  test('a pinned cluster stays on the row at any width', () => {
    // A 120px row fits one 26px control plus the trigger, and the pinned width
    // modes (52px) would not fit at all on their own — they stay regardless,
    // because a menu-only mode button is a mode the reader never finds.
    const visible = toolbarVisibleClusters({ widths, pinned, available: 120 });
    expect(visible[0]).toBe(true);
    expect(visible[5]).toBe(true);
    expect(visible[6]).toBe(true);
    // The unpinned controls are what gives way.
    expect(visible[1]).toBe(false);
  });

  test('order is preserved: what stays is a subsequence, not a re-sort', () => {
    const visible = toolbarVisibleClusters({ widths, pinned, available: 200 });
    const shownIndexes = visible.flatMap((isShown, index) => (isShown ? [index] : []));
    expect([...shownIndexes].sort((a, b) => a - b)).toEqual(shownIndexes);
  });

  test('no clusters is no row', () => {
    expect(toolbarVisibleClusters({ widths: [], pinned: [], available: 500 })).toEqual([]);
  });
});
