/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Batch selection, stated once for both sidebars and both nouns.
 *
 * The sidebar offers TWO selection modes and they are deliberately separate,
 * because the thing being deleted is not the same noun:
 *
 *   - `session` — started from a workspace's own `⋯` menu, and scoped to that
 *     workspace. Deleting removes the sessions; the workspace stays.
 *   - `workspace` — started from the top toolbar. Deleting removes the
 *     workspace registration (and, with it, the rows the sidebar drew for it).
 *
 * One mode is active at a time, and entering either one is an explicit act: the
 * checkboxes do not exist until the user asks for them, because a sidebar that
 * draws a checkbox on every row by default turns every click into a decision
 * between selecting and opening.
 *
 * Selection is an ARRAY of ids rather than a `Set`: it is persisted nowhere and
 * compared only against the rows on screen, so an immutable array keeps the
 * hook's updates trivial and the helpers below pure and unit-testable.
 */

export type BatchMode = 'session' | 'workspace';

/** Toggle one id in the selection, preserving order. */
export function toggleSelection(selected: readonly string[], id: string): string[] {
  return selected.includes(id)
    ? selected.filter((entry) => entry !== id)
    : [...selected, id];
}

/**
 * What a tri-state control (a header checkbox, a count) reports about a set of
 * available ids. `all` is false for an empty list: a header checkbox over a
 * workspace with no sessions must not claim everything is selected.
 */
export interface SelectionSummary {
  count: number;
  all: boolean;
  some: boolean;
}

export function selectionSummary(selected: readonly string[], available: readonly string[]): SelectionSummary {
  const chosen = new Set(selected);
  const count = available.filter((id) => chosen.has(id)).length;
  return {
    count,
    all: available.length > 0 && count === available.length,
    some: count > 0 && count < available.length,
  };
}

/**
 * Every session id a folder's rows can offer to a session-mode selection.
 * Archived rows follow the sidebar's own filter, so "select all" can never
 * select a row the user cannot see (and therefore cannot unselect).
 */
export function selectableSessionIds(
  sessions: readonly { id: number | string; is_archived?: number }[],
  showArchived: boolean,
): string[] {
  return sessions
    .filter((session) => (showArchived ? session.is_archived === 1 : session.is_archived !== 1))
    .map((session) => String(session.id));
}

/**
 * The selected ids that are still present in `available`, in the order the
 * selection recorded them.
 *
 * A selection is deliberately NOT pruned as the list changes: a row can vanish
 * for one render (a folder collapsing under a filter, a push mid-refresh), and
 * an effect that dropped it would silently discard a choice. But the count the
 * bar prints and the ids Delete sends must both be the LIVE set — measured with
 * two tabs open: one deleted a session, and the other's bar went on reading
 * "1 of 0 sessions selected" with Delete enabled for an id that no longer
 * existed anywhere.
 */
export function liveSelection(selected: readonly string[], available: readonly string[]): string[] {
  const alive = new Set(available);
  return selected.filter((id) => alive.has(id));
}
