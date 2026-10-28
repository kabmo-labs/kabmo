/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The editor column's SECOND group: two documents side by side.
 *
 * ## Why this does not touch the panel-width model
 *
 * The plan called split editor the most expensive item because it "conflicts with the
 * coupled editor/right-panel width model". It does not have to. The split lives INSIDE the
 * editor panel: that panel keeps its own width (its fraction, its floor, its diff variant),
 * and the two panes divide the space it already has. Nothing about `panel-widths.ts`
 * changes — no new slot, no second pair, no re-derivation of the 0.7 pair cap — because
 * splitting a column is not the same decision as how wide the column is.
 *
 * ## The two panes are TABS, not a second document list
 *
 * The left pane is the active tab; the right pane is another tab the user picked. That is
 * what keeps ONE tab list authoritative: a second list would need its own ordering, its own
 * close semantics and its own persisted state, and the two could disagree about which file
 * is open. Picking the same tab twice is refused (a pane showing its twin is a wide pane
 * with a divider through it).
 *
 * ## A closed pane's tab is NOT closed
 *
 * Splitting is a view, so closing the right pane leaves the tab open in the strip. The
 * reverse also holds: closing the tab that a pane shows collapses the split, because a pane
 * naming a tab that is gone has nothing to draw.
 */

/** The split's state, persisted per session beside the rest of the layout. */
export interface SplitEditorState {
  /** The tab shown in the RIGHT pane, or null when the column is not split. */
  rightFileId: number | string | null;
  /**
   * The divider's position as a share of the editor panel's width, 0–1.
   *
   * A fraction rather than pixels for the same reason the panel widths are: a pixel value
   * is only right on the display it was dragged on.
   */
  fraction: number;
}

export const DEFAULT_SPLIT: SplitEditorState = { rightFileId: null, fraction: 0.5 };

/** Bounds on the divider, so neither pane can be squeezed out of existence. */
export const MIN_SPLIT_FRACTION = 0.2;
export const MAX_SPLIT_FRACTION = 0.8;

/**
 * Split with `rightFileId`, or refuse when it cannot be shown.
 *
 * Refused cases, each of which would otherwise draw an empty or duplicated pane: the id
 * names the tab the LEFT pane already shows, or the id names no open tab (a stale persisted
 * value after a reload).
 */
export function canSplitTo(
  rightFileId: number | string | null,
  activeFileId: number | string | null,
  openIds: readonly (number | string)[],
): boolean {
  if (rightFileId === null) return false;
  if (rightFileId === activeFileId) return false;
  return openIds.includes(rightFileId);
}

/**
 * The tab a bare "split" gesture should put in the right pane: the most recently opened tab
 * that is not the left pane's own.
 *
 * A menu row can name its tab, but a BUTTON cannot — and the button has to exist, because
 * the tab strip folds every non-active tab into the overflow menu at panel width, so a
 * split reachable only by right-clicking another tab is unreachable in the common case. The
 * newest other tab is the one the user just opened, which is what they mean by "show me both".
 *
 * `null` means there is nothing to split with — one tab, and a divider through one document
 * is not two documents.
 */
export function splitCandidate(
  activeFileId: number | string | null,
  openIds: readonly (number | string)[],
): number | string | null {
  for (let index = openIds.length - 1; index >= 0; index -= 1) {
    const id = openIds[index];
    if (id !== activeFileId) return id;
  }
  return null;
}

/**
 * The split state after the ACTIVE tab changed.
 *
 * The left pane follows the active tab, so a switch that lands on the tab the right pane
 * already shows would draw one file twice. The split collapses in that case rather than
 * silently re-picking a different right pane: the user asked to look at that file, and the
 * whole column showing it is the honest answer.
 */
export function splitAfterActivate(state: SplitEditorState, activeFileId: number | string | null): SplitEditorState {
  if (state.rightFileId === null) return state;
  if (state.rightFileId !== activeFileId) return state;
  return { ...state, rightFileId: null };
}

/** Clamp a dragged divider position into the bounds above. */
export function clampSplitFraction(fraction: number): number {
  if (!Number.isFinite(fraction)) return DEFAULT_SPLIT.fraction;
  return Math.max(MIN_SPLIT_FRACTION, Math.min(MAX_SPLIT_FRACTION, fraction));
}

/**
 * The split's state read from a session blob, defended.
 *
 * A persisted `rightFileId` for a tab that no longer exists is DROPPED rather than trusted:
 * the split would otherwise open onto a pane that cannot render, and the only way out would
 * be to close a pane nobody can see.
 */
export function readSplitState(raw: unknown, openIds: readonly (number | string)[]): SplitEditorState {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_SPLIT;
  const value = raw as { rightFileId?: unknown; fraction?: unknown };
  const fraction = typeof value.fraction === 'number' ? clampSplitFraction(value.fraction) : DEFAULT_SPLIT.fraction;
  const rightFileId =
    typeof value.rightFileId === 'string' || typeof value.rightFileId === 'number' ? value.rightFileId : null;
  if (rightFileId === null || !openIds.includes(rightFileId)) {
    return { rightFileId: null, fraction };
  }
  return { rightFileId, fraction };
}
