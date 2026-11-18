/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which form each control in the filter row takes, by width.
 *
 * The thresholds are the point of this file, so they are pinned by width rather
 * than described: the sidebar's floor is 264px (240px of row content) and its
 * default is 280px (256px). At the default the harness control fits as a glyph
 * beside `Archived`, `Select` as its trailing glyph; at the floor neither narrow
 * form fits and only the harness control wraps. A Select form decided without
 * the harness control would have overflowed the moment the filter was added.
 */

import { describe, expect, test } from 'bun:test';
import {
  FILTER_CHIP_PX,
  FILTER_HARNESS_PX,
  FILTER_ROW_GAP_PX,
  FILTER_SELECT_BUTTON_PX,
  FILTER_SELECT_MINI_PX,
  filterChipGroupWidth,
  filterRowForms,
} from '@/shared/lib/workspace/sidebar-filter-row';

/** The row's content width at a given sidebar width (its `px-3` removed). */
const contentAt = (sidebarWidth: number) => sidebarWidth - 24;

/** The row's width with the harness form and the Select form it budgets for. */
const rowWith = (runningCount: number, harness: number, select: number) =>
  filterChipGroupWidth(runningCount, false) + 2 * FILTER_ROW_GAP_PX + harness + select;

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

describe('filterRowForms', () => {
  test('the 280px default fits the harness glyph and the trailing Select glyph', () => {
    expect(filterRowForms(contentAt(280), 0)).toEqual({
      select: 'button',
      harness: 'icon',
      wrap: false,
    });
  });

  test('a running count still fits at the default, in the mini form', () => {
    expect(filterRowForms(contentAt(280), 2)).toEqual({
      select: 'mini',
      harness: 'icon',
      wrap: false,
    });
  });

  test('the 264px floor fits without a count and wraps with one', () => {
    expect(filterRowForms(contentAt(264), 0).wrap).toBe(false);
    expect(filterRowForms(contentAt(264), 2).wrap).toBe(true);
  });

  test('a wide sidebar takes the harness chip before it takes the Select chip', () => {
    const chipHarnessWithButton = rowWith(0, FILTER_HARNESS_PX.chip, FILTER_SELECT_BUTTON_PX);
    expect(filterRowForms(chipHarnessWithButton, 0)).toEqual({
      select: 'button',
      harness: 'chip',
      wrap: false,
    });

    const chipHarnessWithChip = rowWith(0, FILTER_HARNESS_PX.chip, FILTER_CHIP_PX.select);
    expect(filterRowForms(chipHarnessWithChip, 0)).toEqual({
      select: 'chip',
      harness: 'chip',
      wrap: false,
    });
  });

  test('one pixel under a threshold drops to the next form, never a wrap', () => {
    const chipHarness = rowWith(0, FILTER_HARNESS_PX.chip, FILTER_SELECT_BUTTON_PX);
    expect(filterRowForms(chipHarness - 1, 0).harness).toBe('icon');

    const button = rowWith(0, FILTER_HARNESS_PX.icon, FILTER_SELECT_BUTTON_PX);
    expect(filterRowForms(button - 1, 0).select).toBe('mini');

    const mini = rowWith(0, FILTER_HARNESS_PX.icon, FILTER_SELECT_MINI_PX);
    expect(filterRowForms(mini - 1, 0).wrap).toBe(true);
  });

  test('a running count moves the thresholds with it', () => {
    const withoutCount = rowWith(0, FILTER_HARNESS_PX.chip, FILTER_SELECT_BUTTON_PX);
    const withCount = rowWith(2, FILTER_HARNESS_PX.chip, FILTER_SELECT_BUTTON_PX);
    expect(withCount).toBeGreaterThan(withoutCount);
    expect(filterRowForms(withoutCount, 2).harness).toBe('icon');
    expect(filterRowForms(withCount, 2).harness).toBe('chip');
  });

  test('an unmeasured row keeps the narrow forms rather than guessing', () => {
    expect(filterRowForms(0, 0)).toEqual({ select: 'mini', harness: 'icon', wrap: false });
    expect(filterRowForms(Number.NaN, 0)).toEqual({ select: 'mini', harness: 'icon', wrap: false });
  });
});
