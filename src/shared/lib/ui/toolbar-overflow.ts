/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which toolbar clusters fit on ONE row, and which go into the `⋯` menu.
 *
 * The editor and diff toolbars carry ten-plus controls and the editor panel is
 * 320px wide on a 1440px screen. WRAPPING was the previous answer and it is the
 * wrong one: a second row moves the document down by the toolbar's own height
 * and reads as a second toolbar. A horizontal scroll is worse still — a clipped
 * control is invisible and reads as "there is nothing more here".
 *
 * So: the clusters that do not fit move into a `⋯` menu, and a cluster can be
 * PINNED to stay on the row at every width. Pinning is what keeps this from
 * being a priority guess — the toolbar's visual order is not its priority order
 * (Save is drawn first because that is where a reader looks for it, while the
 * width modes sit last and are the reason the panel exists).
 *
 * Pure, and measured widths in: the caller lays the clusters out once and hands
 * their rendered widths here. A table of guessed pixel widths drifts the moment
 * a label, an icon or a font changes.
 */

/** Width the `⋯` trigger needs, including the gap before it. */
export const TOOLBAR_OVERFLOW_TRIGGER_PX = 30;

/** Gap between two clusters (`gap-x-1`). */
export const TOOLBAR_ITEM_GAP_PX = 4;

export interface ToolbarOverflowArgs {
  /** Rendered width of each cluster, in row order. */
  widths: number[];
  /** Which clusters never leave the row. Same length as `widths`. */
  pinned: boolean[];
  /** Width the row actually has, or 0 before it is measured. */
  available: number;
}

/**
 * Which clusters to render on the row, in row order.
 *
 * An unmeasured row (available 0) keeps everything: hiding controls before the
 * width is known flashes a menu on every mount, and the row is measured a
 * layout effect later.
 */
export function toolbarVisibleClusters({ widths, pinned, available }: ToolbarOverflowArgs): boolean[] {
  if (!(available > 0) || widths.length === 0) return widths.map(() => true);

  const total = widths.reduce((sum, width) => sum + width, 0) + TOOLBAR_ITEM_GAP_PX * (widths.length - 1);
  if (total <= available) return widths.map(() => true);

  // Pinned clusters are placed FIRST and in full, because whether the row is
  // wide enough for them is not a question — they stay and the row clips if it
  // must. The unpinned ones then take whatever is left, in row order, once the
  // `⋯` trigger's own width is set aside. Filling in one pass over row order
  // instead would let an early unpinned control consume the space a pinned one
  // later needs.
  const shown = widths.map(() => false);
  let used = 0;
  let rendered = 0;
  widths.forEach((width, index) => {
    if (!pinned[index]) return;
    used += width + (rendered > 0 ? TOOLBAR_ITEM_GAP_PX : 0);
    rendered += 1;
    shown[index] = true;
  });

  let budget = available - used - TOOLBAR_OVERFLOW_TRIGGER_PX - TOOLBAR_ITEM_GAP_PX;
  widths.forEach((width, index) => {
    if (pinned[index]) return;
    const cost = width + (rendered > 0 ? TOOLBAR_ITEM_GAP_PX : 0);
    if (cost > budget) return;
    budget -= cost;
    rendered += 1;
    shown[index] = true;
  });

  return shown;
}

/** True when at least one cluster is going into the menu. */
export function toolbarHasOverflow(visible: boolean[]): boolean {
  return visible.some((shown) => !shown);
}
