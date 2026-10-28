/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The user's own order for the right-panel buttons.
 *
 * GLOBAL, in `app_settings`, for the same reason the sidebar's width is: the
 * activity bar lists the same panels in every session — only the active
 * highlight moves — so an order stored per session would reshuffle the bar the
 * moment the user picked a different chat.
 *
 * The stored list is a PREFERENCE over ids, not a copy of the catalog. Two
 * consequences follow, and both are the point:
 *
 * - A panel the list does not name is APPENDED, in the order the catalog
 *   already had. A freshly installed plugin therefore appears immediately
 *   instead of being hidden by an order written before it existed.
 * - An id the list names but the catalog does not hold is simply not drawn —
 *   and it is deliberately KEPT, so switching a panel off and on again (or
 *   reinstalling a plugin) returns it to the place the user put it.
 */

import { readKabmoSetting, writeSetting } from '@/shared/lib/settings/client';

/** `app_settings` key holding the panel ids in the user's order. */
export const PANEL_ORDER_SETTING_KEY = 'omp_right_panel_order';

/** The stored order, validated: strings only, no blanks, no duplicates. */
export function readPanelOrder(): string[] {
  const stored = readKabmoSetting<unknown>(PANEL_ORDER_SETTING_KEY);
  if (!Array.isArray(stored)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of stored) {
    if (typeof value !== 'string' || !value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/** Persist a dragged order. */
export function savePanelOrder(ids: readonly string[]): void {
  writeSetting(PANEL_ORDER_SETTING_KEY, [...ids]);
}

/**
 * `panels` in the stored order, with everything the order does not name left in
 * the relative order it arrived in.
 *
 * A stable partition, not a rank sort: a panel absent from the order has no
 * rank, and giving it one (`Infinity`) is only the same thing if the comparison
 * also keeps the ties in place — which is what the `index` tiebreaker below is
 * for.
 */
export function sortPanels<T extends { id: string }>(panels: readonly T[], order: readonly string[]): T[] {
  if (order.length === 0) return [...panels];
  const rank = new Map<string, number>();
  for (const [index, id] of order.entries()) if (!rank.has(id)) rank.set(id, index);
  return panels
    .map((panel, index) => ({ panel, index, rank: rank.get(panel.id) }))
    .sort((a, b) => {
      if (a.rank === undefined) return b.rank === undefined ? a.index - b.index : 1;
      if (b.rank === undefined) return -1;
      return a.rank - b.rank;
    })
    .map((entry) => entry.panel);
}

/**
 * `ids` with `draggedId` moved onto `targetId`.
 *
 * The insertion point is the target's ORIGINAL index, which is what makes the
 * gesture read the same in both directions: dragging down lands the item just
 * BELOW the row it was dropped on (removing the dragged one shifted that row up
 * by one), dragging up lands it just ABOVE it. Returns a copy when either id is
 * absent, so a caller can hand the result straight to a state setter.
 */
export function movePanel(ids: readonly string[], draggedId: string, targetId: string): string[] {
  const from = ids.indexOf(draggedId);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return [...ids];
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, draggedId);
  return next;
}

/**
 * A reorder of the panels that are ON SCREEN, written back over the stored
 * order so the panels that are NOT on screen keep their places.
 *
 * A bar can only drag what it draws, and it does not draw a switched-off panel
 * — so committing the drawn sequence verbatim would silently drop every hidden
 * id from the stored order, and switching that panel back on would append it at
 * the end instead of returning it to where the user put it.
 *
 * The rule is positional: the visible slots in `stored`, in order, are filled
 * with `nextVisible`, in order. Both lists are the same set of ids, so this is
 * exactly the reorder the user made; a visible id `stored` never named (a
 * freshly installed plugin) is appended, and an id in `nextVisible` that is not
 * in `stored` is appended after it.
 */
export function mergeVisibleOrder(
  stored: readonly string[],
  visibleIds: readonly string[],
  nextVisible: readonly string[],
): string[] {
  const visible = new Set(visibleIds);
  const pending = [...nextVisible];
  const placed = new Set<string>();
  const out: string[] = [];
  for (const id of stored) {
    if (!visible.has(id)) {
      out.push(id);
      continue;
    }
    const next = pending.shift();
    if (next === undefined) continue;
    placed.add(next);
    out.push(next);
  }
  for (const id of pending) if (!placed.has(id)) out.push(id);
  return out;
}
