/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The OPEN tabs of a desktop panel column, as data.
 *
 * A browser column keeps a working set, not a catalog: the strip shows what the
 * user opened, the home page shows what could be opened, and the two are
 * different lists. This module is that working set — pure functions over an
 * array of panel ids — so the strip, the home page and the column body cannot
 * disagree about what is open, and the rules can be tested without mounting
 * anything.
 *
 * Five rules, and each is a defect if dropped:
 *
 * 1. **One tab per panel.** The id IS the key: opening a view that is already
 *    open focuses its tab rather than appending a second one, which is the
 *    "duplicate tab" a card grid invites.
 * 2. **A pinned tab cannot be closed.** The left column's session list is the
 *    reason the column exists; a chat with no way back to another chat is a dead
 *    end. `SESSIONS_VIEW_ID` is pinned by the caller, not encoded here.
 * 3. **Closing the ACTIVE tab moves the selection**, to the right neighbour
 *    first (the tab that took its place), else the left one. Closing a tab you
 *    are not looking at leaves the selection alone.
 * 4. **Closing the last tab leaves the column on its home page**, not on a blank
 *    body and not on an implicit view the user never opened.
 * 5. **A stored id this build cannot draw is dropped on read**, not rendered as
 *    an empty body. A disabled panel, an uninstalled plugin, a bundle that has
 *    not loaded yet all produce that state.
 */

/** The ids a column is showing, in strip order. */
export type PanelTabs = readonly string[];

/** Opening a view that is already open focuses it; it never appends. */
export function openPanelTab(tabs: PanelTabs, id: string): PanelTabs {
  return tabs.includes(id) ? tabs : [...tabs, id];
}

/**
 * Close one tab.
 *
 * Returns the surviving list; the caller decides the selection with
 * `nextActiveTab` so the two questions stay separate (closing a background tab
 * must not move the selection).
 */
export function closePanelTab(tabs: PanelTabs, id: string, pinned?: string): PanelTabs {
  if (id === pinned) return tabs;
  return tabs.filter((tab) => tab !== id);
}

/**
 * Which tab a column shows after the list changed — the four cases a strip has.
 *
 * - the current selection still exists → keep it (a background close, an open of
 *   an already-open view);
 * - the selection was closed → the tab that slid into its index, else the one
 *   before it;
 * - nothing is open → `null`, which is the home page;
 * - the selection named a view this build cannot draw → the first tab.
 */
export function nextActiveTab(
  previous: PanelTabs,
  next: PanelTabs,
  activeId: string | null,
): string | null {
  if (next.length === 0) return null;
  if (activeId !== null && next.includes(activeId)) return activeId;
  if (activeId === null) return next[0] ?? null;
  // The closed tab's own index in the OLD list is where its replacement now
  // sits: the tab after it, or the last one when it was the tail.
  const index = previous.indexOf(activeId);
  if (index === -1) return next[0] ?? null;
  return next[Math.min(index, next.length - 1)] ?? next[0] ?? null;
}

/**
 * The stored list, filtered against what the column can draw right now.
 *
 * Order is preserved, duplicates are dropped, and a survivor list is returned
 * even when everything was filtered out — an empty list is the home page, which
 * is a state, not an error.
 */
export function visiblePanelTabs(tabs: PanelTabs, known: ReadonlySet<string>): PanelTabs {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of tabs) {
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * The pinned view is always the FIRST tab of its column.
 *
 * A tab strip whose first chip moves is a strip the user has to re-read; the
 * session list is the column's own view, so it leads on every read.
 */
export function withPinnedTab(tabs: PanelTabs, pinned: string): PanelTabs {
  return tabs[0] === pinned ? tabs : [pinned, ...tabs.filter((id) => id !== pinned)];
}
