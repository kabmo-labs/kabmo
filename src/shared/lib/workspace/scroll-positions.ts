/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Where each tab was left scrolled.
 *
 * The editor column keeps ONE scroll container per surface and swaps the
 * document inside it on a tab switch, so the browser clamps the shared scroller
 * to the height of the document now in it — returning to a long file landed at
 * line 1. These offsets are what puts the reader back, and they live in the
 * session's own UI state so a reload restores them too.
 *
 * Stored as `{ [tabKey]: { [surface]: px } }` — one entry per tab AND per
 * surface, because the same tab scrolled in its rendered view and in its source
 * is two different documents: a markdown preview and its code share neither a
 * line nor a height, so one offset cannot serve both.
 *
 * A tab at the top of a document carries NO entry: the top is the absence of a
 * value, not a stored `0`, which is what keeps the map from filling with rows
 * that say nothing.
 */

/**
 * Which surface of a tab the offset belongs to: `code`/`rendered` for a file
 * tab (the eye toggle), `unified`/`split` for a diff (the two row shapes).
 */
export type ScrollSurface = 'code' | 'rendered' | 'unified' | 'split';

/** Offsets per tab key, then per surface. */
export type ScrollPositions = Record<string, Partial<Record<ScrollSurface, number>>>;

/** The session-state slot these live in (see the key namespace in the store). */
export const SCROLL_POSITIONS_KEY = 'editor.scrollPositions';

/**
 * The phone editor's own slot.
 *
 * It is keyed by PATH (it shows one file at a time and has no tab ids) while the
 * desktop column is keyed by tab id, and two key spaces in one map is what makes
 * the desktop's prune — "drop the offsets of tabs that are no longer open" —
 * delete an entry the phone still needs. Separate slots keep the two owners from
 * reaching into each other's entries. Nothing prunes this one: it is bounded by
 * the files opened in one session, and each entry is a single number.
 */
export const MOBILE_SCROLL_POSITIONS_KEY = 'editor.mobileScrollPositions';

/** The stored offset for one tab+surface; `0` (the top) when nothing was stored. */
export function readScrollTop(positions: ScrollPositions | undefined, tabKey: string, surface: ScrollSurface): number {
  const top = positions?.[tabKey]?.[surface];
  return typeof top === 'number' && Number.isFinite(top) && top > 0 ? top : 0;
}

/**
 * A new map with one offset set — or the INPUT, unchanged, when the value did
 * not move. Callers compare identity, so a scroll that ends where it started
 * costs no write and no persist.
 *
 * An offset of `0` (or less) REMOVES the entry, per the rule above: a reader who
 * scrolled back to the top has nothing to remember, and keeping the zero would
 * leave a row per tab for the life of the session.
 */
export function writeScrollTop(
  positions: ScrollPositions | undefined,
  tabKey: string,
  surface: ScrollSurface,
  top: number,
): ScrollPositions {
  const current = positions?.[tabKey]?.[surface];
  if (current === top) return positions ?? {};
  if (top <= 0) {
    if (current === undefined) return positions ?? {};
    const surfaces = { ...positions?.[tabKey] };
    delete surfaces[surface];
    const next = { ...positions };
    if (Object.keys(surfaces).length === 0) delete next[tabKey];
    else next[tabKey] = surfaces;
    return next;
  }
  return { ...positions, [tabKey]: { ...positions?.[tabKey], [surface]: top } };
}

/**
 * Drop ONE tab's offsets — a new map, or the input unchanged when the tab had
 * none.
 *
 * Called where a tab actually closes (and where the workspace switch closes
 * every tab), never from an effect watching the open list. That distinction is
 * load-bearing: an effect sees the list at moments that are not user actions —
 * before the session's blob has restored the tabs, and while a workspace switch
 * is mid-flight — and pruning against a transiently empty list deleted every
 * stored position on the way in (measured: the offset persisted, then came back
 * as `{}` after a reload).
 */
export function dropScrollPosition(positions: ScrollPositions | undefined, tabKey: string): ScrollPositions {
  if (!positions || !(tabKey in positions)) return positions ?? {};
  const next = { ...positions };
  delete next[tabKey];
  return next;
}
