/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * How the `modern` sidebar's filter row spends its width on the Select control.
 *
 * The row is `All · Running · Archived` plus the way into batch selection, and
 * it must never wrap: a second line of chips pushes the list down and reads as a
 * layout break. The two forms are therefore chosen by MEASURED width, the same
 * way the classic toolbar picks its visible controls (`sidebarToolbarCapacity`),
 * and for the same reason — the sidebar is draggable, so a media query or a
 * `@container` breakpoint would keep a narrow form after the user widened the
 * panel.
 *
 *  - `button` — a 28px glyph pinned to the row's trailing edge. This is the form
 *    at the 280px default and at the 264px floor.
 *  - `chip` — a fourth chip, in the same trailing slot. It only fits once the
 *    sidebar is wide enough for four chips.
 *
 * **The form changes the Select control, never the chip group.** All, Running
 * and Archived keep the row's left edge in both forms — they are a reading order
 * that sits under the search field and over the rows, so moving them sideways
 * when the fourth chip appears made the filters jump as the panel was dragged.
 *
 * The metrics are the chips' own rendered widths at `text-[11px]` with
 * `px-2`/`gap-1`, measured in the browser at the 280px default. They are
 * constants rather than a render-time measurement of the children because the
 * FORM has to be decided before the children exist — measuring after paint would
 * draw the wrong form for a frame, which is the flicker `useToolbarRowWidth`'s
 * layout effect exists to avoid.
 */

/** The row's own `px-3`, which `clientWidth` counts and the budget must not. */
export const FILTER_ROW_PADDING_PX = 24;

/** The row's `gap-1`, between chips and before the trailing control. */
export const FILTER_ROW_GAP_PX = 4;

/** The two chip forms, measured at `text-[11px] font-medium`. */
export const FILTER_CHIP_PX = {
  all: 32,
  running: 72,
  /** The count badge inside `Running`, when there is something to count. */
  runningCount: 14,
  archived: 79,
  /** The Select chip: icon, the word, and its padding. */
  select: 66,
} as const;

/** The trailing glyph (`h-7 w-7`). */
export const FILTER_SELECT_BUTTON_PX = 28;

/**
 * The width the chip group needs for a given running count.
 *
 * Exported because the answer is the threshold both forms are compared
 * against — a caller that recomputes it would drift from the chips it budgets
 * for.
 */
export function filterChipGroupWidth(runningCount: number, includeSelect: boolean): number {
  const chips = [
    FILTER_CHIP_PX.all,
    FILTER_CHIP_PX.running + (runningCount > 0 ? FILTER_CHIP_PX.runningCount : 0),
    FILTER_CHIP_PX.archived,
    ...(includeSelect ? [FILTER_CHIP_PX.select] : []),
  ];
  return chips.reduce((sum, width) => sum + width, 0) + (chips.length - 1) * FILTER_ROW_GAP_PX;
}

/**
 * Which form the Select control takes in a row `available` px wide.
 *
 * The caller right-aligns the control itself; the chips it is measured against
 * stay at the row's left edge.
 *
 * `available` is the row's CONTENT width (the caller's `px-3` already
 * subtracted). A row that reports `0` — a collapsed panel, or a layout that has
 * not run yet — keeps the `button` form: it is the narrowest, so it is the
 * answer that can never be wrong.
 */
export function filterSelectForm(available: number, runningCount: number): 'button' | 'chip' {
  if (!(available > 0)) return 'button';
  return filterChipGroupWidth(runningCount, true) <= available ? 'chip' : 'button';
}
