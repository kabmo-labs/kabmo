/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The USER browser's tab model — pure, so every rule about "which page is this
 * tab on" is testable without an iframe.
 *
 * An iframe's internal navigation is invisible from this origin (the host gets
 * `onLoad` and nothing else), so a tab's history is the list of addresses the
 * USER typed or committed. That is exactly what Back/Forward need, and it is
 * why nothing here reads the frame.
 *
 * Two invariants hold everywhere:
 * - `index` is `-1` only for a blank tab (`history` empty); otherwise it always
 *   points at an entry, so `tabUrl` never silently answers the wrong page.
 * - `frameKey` is bumped by RELOAD (the same address must remount) and by a new
 *   address (a re-submitted URL must reload). A tab switch changes the page
 *   without bumping it, which is why the panel keys the frame on tab id + this
 *   number together — two tabs at `frameKey: 0` are still two pages.
 */

import { shortUrl } from '@/shared/lib/browser/activity';

export interface UserBrowserTab {
  id: string;
  /** Addresses this tab has loaded, in order. */
  history: string[];
  /** Where in `history` the tab is; `-1` when the tab has never loaded. */
  index: number;
  /** Bumped to remount the SAME address (reload). */
  frameKey: number;
}

/** Tabs a session may keep. A strip longer than this is a list, not a strip. */
export const MAX_USER_BROWSER_TABS = 12;

/** Addresses one tab remembers; the oldest are dropped past this. */
export const MAX_TAB_HISTORY = 60;

/** A stored URL longer than this is junk, not an address. */
const MAX_URL_CHARS = 8192;

let tabSeq = 0;

/** Ids only need to be unique within one session's strip. */
export function nextTabId(): string {
  tabSeq += 1;
  return `tab-${Date.now().toString(36)}-${tabSeq}`;
}

export function createTab(id: string, url = ''): UserBrowserTab {
  return url ? { id, history: [url], index: 0, frameKey: 0 } : { id, history: [], index: -1, frameKey: 0 };
}

/** The page this tab is on, or `''` for a blank tab. */
export function tabUrl(tab: UserBrowserTab | null | undefined): string {
  if (!tab || tab.index < 0) return '';
  return tab.history[tab.index] ?? '';
}

/** Back/Forward availability, from the same two fields the panel reads. */
export function tabCanGoBack(tab: UserBrowserTab | null | undefined): boolean {
  return Boolean(tab) && tab!.index > 0;
}

export function tabCanGoForward(tab: UserBrowserTab | null | undefined): boolean {
  return Boolean(tab) && tab!.index >= 0 && tab!.index < tab!.history.length - 1;
}

/**
 * Commit `url` in this tab: drop the forward entries (a new address is a new
 * branch) and append. The `frameKey` bump is what makes re-submitting the SAME
 * address reload it — an unchanged `src` never navigates — and a repeat of the
 * address already on screen is NOT a new history entry, so Back does not walk
 * through duplicates.
 */
export function pushAddress(tab: UserBrowserTab, url: string): UserBrowserTab {
  if (tabUrl(tab) === url) return reloadTab(tab);
  const history = [...tab.history.slice(0, tab.index + 1), url];
  const overflow = Math.max(0, history.length - MAX_TAB_HISTORY);
  const trimmed = overflow > 0 ? history.slice(overflow) : history;
  return { ...tab, history: trimmed, index: trimmed.length - 1, frameKey: tab.frameKey + 1 };
}

/** Move within the tab's own history; a step past either end is a no-op. */
export function stepTab(tab: UserBrowserTab, delta: -1 | 1): UserBrowserTab {
  const next = tab.index + delta;
  if (next < 0 || next >= tab.history.length) return tab;
  return { ...tab, index: next };
}

export function reloadTab(tab: UserBrowserTab): UserBrowserTab {
  return { ...tab, frameKey: tab.frameKey + 1 };
}

/**
 * Remove a tab and decide which one the panel shows next.
 *
 * Closing the ACTIVE tab selects the neighbour to its right, else its left —
 * the same rule the agent panel's strip uses (`shared/lib/browser/tab-close.ts`),
 * so staying in the region the user was looking at is one convention, not two.
 * Closing an inactive tab never moves the selection.
 */
export function closeTabIn(
  tabs: UserBrowserTab[],
  activeId: string | null,
  closingId: string,
): { tabs: UserBrowserTab[]; activeId: string | null } {
  const index = tabs.findIndex((tab) => tab.id === closingId);
  if (index === -1) return { tabs, activeId };
  const remaining = tabs.filter((tab) => tab.id !== closingId);
  if (activeId !== closingId) return { tabs: remaining, activeId };
  const next = remaining[Math.min(index, remaining.length - 1)] ?? null;
  return { tabs: remaining, activeId: next ? next.id : null };
}

/**
 * The active tab, falling back to the newest one.
 *
 * The persisted `activeTabId` can name a tab a closed window (or an older
 * build) removed; a strip that renders with no active tab is a strip whose
 * address bar shows nothing while a page is on screen.
 */
export function activeTabOf(tabs: UserBrowserTab[], activeId: string | null): UserBrowserTab | null {
  return tabs.find((tab) => tab.id === activeId) ?? tabs[tabs.length - 1] ?? null;
}

function readHistory(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const url = entry.trim();
    if (!url || url.length > MAX_URL_CHARS) continue;
    out.push(url);
    if (out.length >= MAX_TAB_HISTORY) break;
  }
  return out;
}

/**
 * Sanitize the persisted strip. The blob is untrusted input: an older build, a
 * hand-edited row or a truncated write must yield a strip that renders, not a
 * crash in the middle of the address bar.
 */
export function pruneTabs(value: unknown): UserBrowserTab[] {
  if (!Array.isArray(value)) return [];
  const tabs: UserBrowserTab[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    if (!id || seen.has(id)) continue;
    const history = readHistory(record.history);
    const storedIndex = typeof record.index === 'number' && Number.isFinite(record.index) ? Math.trunc(record.index) : -1;
    const index =
      history.length === 0 ? -1 : Math.min(history.length - 1, Math.max(0, storedIndex === -1 ? 0 : storedIndex));
    const storedKey = typeof record.frameKey === 'number' && Number.isFinite(record.frameKey) ? Math.trunc(record.frameKey) : 0;
    seen.add(id);
    tabs.push({ id, history, index, frameKey: Math.max(0, storedKey) });
    if (tabs.length >= MAX_USER_BROWSER_TABS) break;
  }
  return tabs;
}

/** What the strip says for a tab: its host+path, since no page title exists. */
export function tabLabel(tab: UserBrowserTab): string {
  return shortUrl(tabUrl(tab)) || 'Tab baru';
}
