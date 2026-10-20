/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * How many controls the desktop session-sidebar toolbar can show before the
 * row runs out of room.
 *
 * The sidebar is 264–500px wide on any screen, and the row has to hold the
 * primary New Session button plus seven icon controls. At the narrow end that
 * does not fit, and the previous answer was to let the label collapse to two
 * pixels while every icon stayed. This module decides instead: keep the most
 * important controls on the row and move the rest into a `⋯` menu, which is
 * one more slot of its own.
 *
 * It is a pure function of the row's measured width, so the boundary is
 * testable without a browser — the widths below are the row's real metrics
 * (`w-7` buttons, `gap-1.5`, the `ml-auto` gap before the right cluster).
 */

/** Every control the toolbar can draw. */
export type SidebarToolbarControl =
  | 'new-workspace'
  | 'scheduler'
  | 'refresh'
  | 'search'
  | 'select'
  | 'archive'
  | 'sort';

/**
 * Most important first. The TAIL of this list is what the `⋯` menu takes, so a
 * control's position here is the only thing that decides whether it survives a
 * narrow sidebar.
 *
 * The first two NEVER move: New Workspace sits beside New Session (the phone's
 * order) and Refresh is the one control a stale list is repaired with, so both
 * are on the row at every legal width — `sidebarToolbarCapacity` reserves their
 * slots. Collapsing the sidebar is deliberately absent: it lives in the title
 * bar, which is where the phone puts its own close control.
 */
export const SIDEBAR_TOOLBAR_PRIORITY: SidebarToolbarControl[] = [
  'new-workspace',
  'refresh',
  'search',
  // Batch selection sits beside search: both are modes over the LIST, and both
  // are entered deliberately — unlike archive/sort, which change what the list
  // shows. It is after the two floored controls, so it can move into the `⋯`
  // menu on a narrow sidebar like any other mode.
  'select',
  'archive',
  'scheduler',
  'sort',
];

/**
 * The primary button at its comfortable width: icon, padding, and the whole
 * "New Session" label (75px). The label NEVER ellipsises and NEVER leaves the
 * row, so this is the width the capacity budget must reserve for it.
 */
export const TOOLBAR_PRIMARY_PX = 112;
/**
 * Controls that stay on the row at every legal sidebar width. Their metrics
 * are what `sidebarToolbarCapacity` floors its answer at, so no drag can push
 * them into the menu.
 */
export const TOOLBAR_ALWAYS_VISIBLE = 2;
/** One icon control (`w-7`). */
export const TOOLBAR_ITEM_PX = 28;
/** `gap-1.5` inside a cluster. */
export const TOOLBAR_GAP_PX = 6;
/** The row's own `gap-2` between the left cluster and the right one. */
export const TOOLBAR_CLUSTER_GAP_PX = 8;
/** The row's own `px-1`, which `clientWidth` counts and the budget must not. */
export const TOOLBAR_ROW_PADDING_PX = 8;

/**
 * How many of `SIDEBAR_TOOLBAR_PRIORITY` fit in a row `available` px wide.
 *
 * `available` is the row's CONTENT width — the toolbar's padding is already
 * subtracted, which is what a `ResizeObserver` on the row reports. A row that
 * reports `0` (a collapsed sidebar, or a layout that has not run yet) keeps the
 * full set: the capacity only ever hides controls it has actually measured no
 * room for.
 *
 * At least `TOOLBAR_ALWAYS_VISIBLE` controls stay on the row at every width:
 * the metrics below are sized so the primary button at its full label plus
 * those two and the `⋯` slot fit inside the narrowest legal sidebar (264px,
 * 240px of row content), so a narrow window can never push them into the menu.
 */
export function sidebarToolbarCapacity(available: number): number {
  const count = SIDEBAR_TOOLBAR_PRIORITY.length;
  if (!(available > 0)) return count;

  const budget = available - TOOLBAR_PRIMARY_PX - TOOLBAR_GAP_PX - TOOLBAR_CLUSTER_GAP_PX;

  // Every control on the row, no menu.
  const all = count * TOOLBAR_ITEM_PX + (count - 1) * TOOLBAR_GAP_PX;
  if (all <= budget) return count;

  // With a `⋯` slot the row costs `k` items plus that slot, `k` gaps between
  // them, and the cluster gap.
  const fits = Math.floor((budget - TOOLBAR_ITEM_PX - TOOLBAR_CLUSTER_GAP_PX) / (TOOLBAR_ITEM_PX + TOOLBAR_GAP_PX));
  return Math.max(TOOLBAR_ALWAYS_VISIBLE, Math.min(count, fits));
}

/* -------------------------------------------------------------------------
 * The PHONE's drawer row.
 *
 * Same rule, different metrics: one row of `w-9.5` (38px) buttons with
 * `space-x-2` (8px) gaps, inside a `p-3` drawer — so 46px per control against
 * the desktop's 34. The phone therefore runs out of room much earlier, and it
 * used to answer that by squeezing whatever flexbox could shrink — which was
 * the primary button's own `Plus` icon, measured at 1px at 412 and 0px at
 * 390/375/360. The row now keeps the head of this list and moves the tail into
 * the same `⋯` menu the desktop toolbar uses.
 *
 * `search` is absent on purpose: the phone's search is a permanent field in the
 * row below, not a toggle, so it is never a control that can overflow.
 * ---------------------------------------------------------------------- */

/** One phone toolbar control (`w-9.5`). */
export const MOBILE_TOOLBAR_ITEM_PX = 38;
/** `space-x-2` between the primary pill and every control. */
export const MOBILE_TOOLBAR_GAP_PX = 8;
/**
 * The primary pill with its label: `Plus` (15) + the `space-x-2` gap (8) + the
 * whole "New Session" string (75) + `px-3.5` (28) + the borders, measured at
 * 126px in the browser.
 *
 * This is the desktop row's rule applied to the phone: the label is budgeted
 * for in FULL, so it never ellipsises in practice and never leaves the row.
 * Letting it share a flex row with the icons is what produced the reported bug
 * — the label's `whitespace-nowrap` min-content is the whole string, so it
 * refused to shrink and the `Plus` beside it absorbed the entire shortfall,
 * measured 1px at 412 and 0px at 390/375/360.
 */
export const MOBILE_TOOLBAR_PRIMARY_PX = 126;
/** Floors `mobileToolbarCapacity`, so the head of the list always survives. */
export const MOBILE_TOOLBAR_ALWAYS_VISIBLE = 1;

/**
 * Most important first — the tail is what the `⋯` menu takes.
 *
 * Refresh outranks the modes because it is the one control a stale list is
 * repaired with (the desktop row floors it for the same reason). The two VIEW
 * controls follow: archive and sort decide what the list shows, and they are
 * the pair the phone's own spec asserts are on the row at a Pixel 7 width
 * (412px, a 388px row, four controls beside the menu). The two MODE controls
 * are the tail, because each one is entered deliberately and returns: the
 * scheduler opens a modal, and batch selection is a transient state whose own
 * action bar takes over the drawer once it is on.
 */
export const MOBILE_TOOLBAR_PRIORITY: SidebarToolbarControl[] = [
  'new-workspace',
  'refresh',
  'archive',
  'sort',
  'scheduler',
  'select',
];

/**
 * How many of `MOBILE_TOOLBAR_PRIORITY` fit beside the primary pill in a row
 * `available` px wide.
 *
 * `available` is the row's content width (the drawer's `p-3` already removed).
 * A row that reports `0` keeps the full set: the capacity only ever hides a
 * control it has measured no room for, so a first render cannot flicker.
 *
 * The `⋯` menu, when it is needed, costs one of the counted slots — the same
 * 38px plus gap as any control it replaces. That is why a row that fits `k`
 * slots but not all of them shows `k − 1` controls: the last one is the menu.
 */
export function mobileToolbarCapacity(available: number): number {
  const count = MOBILE_TOOLBAR_PRIORITY.length;
  if (!(available > 0)) return count;

  const step = MOBILE_TOOLBAR_ITEM_PX + MOBILE_TOOLBAR_GAP_PX;
  const fits = Math.floor((available - MOBILE_TOOLBAR_PRIMARY_PX) / step);
  if (fits >= count) return count;
  return Math.max(MOBILE_TOOLBAR_ALWAYS_VISIBLE, Math.min(count, fits - 1));
}
