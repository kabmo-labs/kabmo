/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * How the `modern` sidebar's filter row spends its width.
 *
 * The row is `All · Running · Archived · harness · Select`, and it must never
 * wrap: a second line of chips pushes the list down and reads as a layout
 * break. Each control's form is therefore chosen by MEASURED width, richest
 * first, the same way the classic toolbar picks its visible controls
 * (`sidebarToolbarCapacity`), and for the same reason — the sidebar is
 * draggable, so a media query or a `@container` breakpoint would keep a narrow
 * form after the user widened the panel.
 *
 *  - **Select** — `button` (a 28px glyph pinned to the row's trailing edge) or
 *    `chip` (a fourth chip in the same slot).
 *  - **Harness** — `chip` (glyph, name, chevron) or `icon` (the harness's own
 *    mark in the row's 22px slot). It sits immediately right of `Archived`,
 *    which is where the user looks for it.
 *
 * **The forms change the controls, never the chip group's position.** All,
 * Running and Archived keep the row's left edge in every form — they are a
 * reading order that sits under the search field and over the rows, so moving
 * them sideways when a form changed made the filters jump as the panel was
 * dragged.
 *
 * The metrics are the controls' own rendered widths at `text-[11px]` with
 * `px-2`/`gap-1`, measured in the browser. They are constants rather than a
 * render-time measurement of the children because the FORM has to be decided
 * before the children exist — measuring after paint would draw the wrong form
 * for a frame, which is the flicker `useToolbarRowWidth`'s layout effect exists
 * to avoid.
 */

/** The row's own `px-3`, which `clientWidth` counts and the budget must not. */
export const FILTER_ROW_PADDING_PX = 24;

/** The row's `gap-1`, between chips and before the trailing control. */
export const FILTER_ROW_GAP_PX = 4;

/** The two chip forms, measured at `text-[11px] font-medium`. */
export const FILTER_CHIP_PX = {
  all: 32,
  /** `Running` with its dot, before the count badge. Measured 68.6. */
  running: 69,
  /** The count badge inside `Running`, when there is something to count. */
  runningCount: 14,
  archived: 79,
  /** The Select chip: icon, the word, and its padding. */
  select: 66,
} as const;

/** The trailing glyph (`h-7 w-7`). */
export const FILTER_SELECT_BUTTON_PX = 28;

/**
 * The Select glyph when the harness control shares the row (`h-[22px] w-[22px]`).
 *
 * Not a third style for its own sake: with a running count and the harness mark
 * inline, the 28px form measured 4px too wide at the 280px default, and the
 * alternative — letting the row wrap — put the only way into batch selection on
 * a line of its own. 22px is the slot the session rows already use for their
 * trailing control.
 */
export const FILTER_SELECT_MINI_PX = 22;

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
 * The harness trigger's two forms.
 *
 * `chip` is the full control — glyph, the words "All harnesses" (or the active
 * harness's name), and the chevron — measured at 104.7px in the browser at the
 * default width. `icon` is the narrow form: the active harness's own mark (or a
 * generic agent mark) in the row's 22px trailing slot, which is the same slot
 * the session rows use for their `⋯`.
 */
export const FILTER_HARNESS_PX = {
  chip: 105,
  icon: 22,
} as const;

export interface FilterRowForms {
  select: 'chip' | 'button' | 'mini';
  harness: 'chip' | 'icon';
  /**
   * True when even the narrow forms do not fit. The harness control then wraps
   * to a second line — the row never clips a control, and the alternative (a
   * 16px target) is not a control.
   */
  wrap: boolean;
}

/**
 * Which form each control takes in a row `available` px wide.
 *
 * The row is `All · Running · Archived · harness · Select`, and it must never
 * wrap: a second line of chips pushes the list down and reads as a layout
 * break. The forms are therefore chosen by MEASURED width, richest first, and
 * the harness control is part of the budget — a Select form decided without it
 * would overflow the moment the filter was added.
 *
 * `available` is the row's CONTENT width (the caller's `px-3` already
 * subtracted). A row that reports `0` — a collapsed panel, or a layout that has
 * not run yet — keeps the narrowest forms: they are the answer that can never
 * be wrong.
 */
export function filterRowForms(available: number, runningCount: number): FilterRowForms {
  if (!(available > 0)) return { select: 'mini', harness: 'icon', wrap: false };
  const base = filterChipGroupWidth(runningCount, false);
  const fits = (harness: number, select: number) =>
    base + 2 * FILTER_ROW_GAP_PX + harness + select <= available;

  if (fits(FILTER_HARNESS_PX.chip, FILTER_CHIP_PX.select)) {
    return { select: 'chip', harness: 'chip', wrap: false };
  }
  if (fits(FILTER_HARNESS_PX.chip, FILTER_SELECT_BUTTON_PX)) {
    return { select: 'button', harness: 'chip', wrap: false };
  }
  if (fits(FILTER_HARNESS_PX.icon, FILTER_SELECT_BUTTON_PX)) {
    return { select: 'button', harness: 'icon', wrap: false };
  }
  if (fits(FILTER_HARNESS_PX.icon, FILTER_SELECT_MINI_PX)) {
    return { select: 'mini', harness: 'icon', wrap: false };
  }
  return { select: 'mini', harness: 'icon', wrap: true };
}
