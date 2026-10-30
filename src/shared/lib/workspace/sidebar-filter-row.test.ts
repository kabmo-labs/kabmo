/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which form the filter row's Select control takes, and when the chip group
 * moves to the right edge.
 *
 * The thresholds are the point of this file, so they are pinned by width rather
 * than described: the sidebar's floor is 264px (240px of row content) and its
 * default is 280px (256px), which is exactly where four chips stop fitting —
 * measured 265px — and why the trailing glyph is what ships at the default.
 */

import { describe, expect, test } from 'bun:test';
import {
  FILTER_CHIP_PX,
  FILTER_ROW_GAP_PX,
  filterChipGroupWidth,
  filterSelectForm,
} from '@/shared/lib/workspace/sidebar-filter-row';

/** The row's content width at a given sidebar width (its `px-3` removed). */
const contentAt = (sidebarWidth: number) => sidebarWidth - 24;

describe('filterChipGroupWidth', () => {
  test('three chips plus two gaps', () => {
    expect(filterChipGroupWidth(0, false)).toBe(
      FILTER_CHIP_PX.all + FILTER_CHIP_PX.running + FILTER_CHIP_PX.archived + 2 * FILTER_ROW_GAP_PX,
    );
  });

  test('the Select chip adds its own width and one more gap', () => {
    expect(filterChipGroupWidth(0, true) - filterChipGroupWidth(0, false)).toBe(
      FILTER_CHIP_PX.select + FILTER_ROW_GAP_PX,
    );
  });

  test('a count badge widens the Running chip', () => {
    expect(filterChipGroupWidth(3, false) - filterChipGroupWidth(0, false)).toBe(FILTER_CHIP_PX.runningCount);
  });
});

describe('filterSelectForm', () => {
  test('the 264px floor and the 280px default both take the trailing glyph', () => {
    expect(filterSelectForm(contentAt(264), 0)).toBe('button');
    expect(filterSelectForm(contentAt(280), 0)).toBe('button');
  });

  test('the default does NOT fit four chips — the reason the row used to wrap', () => {
    expect(filterChipGroupWidth(0, true)).toBeGreaterThan(contentAt(280));
  });

  test('a wide sidebar takes the fourth chip, which is when the group right-aligns', () => {
    const wide = filterChipGroupWidth(0, true);
    expect(filterSelectForm(wide, 0)).toBe('chip');
    expect(filterSelectForm(wide - 1, 0)).toBe('button');
  });

  test('a running count moves the threshold with it', () => {
    const withoutCount = filterChipGroupWidth(0, true);
    const withCount = filterChipGroupWidth(2, true);
    expect(withCount).toBeGreaterThan(withoutCount);
    expect(filterSelectForm(withoutCount, 2)).toBe('button');
    expect(filterSelectForm(withCount, 2)).toBe('chip');
  });

  test('an unmeasured row keeps the narrow form rather than guessing', () => {
    expect(filterSelectForm(0, 0)).toBe('button');
    expect(filterSelectForm(Number.NaN, 0)).toBe('button');
  });
});
