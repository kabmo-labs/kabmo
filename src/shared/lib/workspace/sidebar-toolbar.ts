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
