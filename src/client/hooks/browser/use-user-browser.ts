/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Tabs + address bar for the user's iframe browser.
 *
 * Each tab owns its OWN history, because that is the whole point of tabs: Back
 * in the second tab must not land on a page the first one visited. The tab list
 * and its selection are persisted per session, so reopening the panel restores
 * the pages the user had — an iframe's internal navigation is invisible from
 * this origin, so the addresses the user committed are the only record there is.
 *
 * The legacy single-history slots (`userBrowser.history` / `historyIndex`) are
 * migrated into one tab on the first restore; a session stored before tabs
 * existed must not come back blank.
 *
 * `frameKey` is per tab. The panel keys the iframe on tab id + that number, so
 * a switch changes the page without remounting the other tab's document —
 * scroll position, form state and logins survive a switch, as in a browser.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { useSessionState } from '@/client/hooks/workspace/session-state';
import { useSessionStateContext } from '@/client/hooks/workspace/session-state/context';
import { getSessionValue } from '@/shared/lib/workspace/session-state/store';
import { normalizeUrl } from '@/shared/lib/browser/url';
import {
  MAX_USER_BROWSER_TABS,
  activeTabOf,
  closeTabIn,
  createTab,
  nextTabId,
  pruneTabs,
  pushAddress,
  reloadTab,
  stepTab,
  tabCanGoBack,
  tabCanGoForward,
  tabUrl,
  type UserBrowserTab,
} from '@/shared/lib/browser/user-tabs';

export type { UserBrowserTab };

export interface UseUserBrowserResult {
  tabs: UserBrowserTab[];
  /** The tab on screen; the newest one when the stored id no longer exists. */
  activeTab: UserBrowserTab | null;
  activeTabId: string | null;
  /** URL currently loaded in the active tab ('' when it is blank). */
  url: string;
  /** Address-bar text; persisted per session. */
  input: string;
  setInput: (value: string) => void;
  /** Bumped by the active tab to force its frame to reload the same URL. */
  frameKey: number;
  loading: boolean;
  error?: string;
  canGoBack: boolean;
  canGoForward: boolean;
  canOpenTab: boolean;
  submit: (raw: string) => void;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
  /** The active tab's frame finished loading. */
  markLoaded: (tabId: string) => void;
  openTab: () => void;
  selectTab: (tabId: string) => void;
  closeTab: (tabId: string) => void;
}

const TABS_KEY = 'userBrowser.tabs';
const ACTIVE_KEY = 'userBrowser.activeTabId';
const INPUT_KEY = 'userBrowser.inputUrl';
/** Retired single-history slots, migrated into the first tab on restore. */
const LEGACY_HISTORY_KEY = 'userBrowser.history';
const LEGACY_INDEX_KEY = 'userBrowser.historyIndex';

export function useUserBrowser(): UseUserBrowserResult {
  const [tabs, setTabs] = useSessionState<UserBrowserTab[]>(TABS_KEY, []);
  const [activeTabId, setActiveTabId] = useSessionState<string | null>(ACTIVE_KEY, null);
  const [input, setInput] = useSessionState<string>(INPUT_KEY, '');
  /** The tab whose frame is loading — not "the panel is loading", so a
   *  background tab's load never spins the address bar of the visible one. */
  const [loadingTabId, setLoadingTabId] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const { sessionId, ready } = useSessionStateContext();
  const reconciled = useRef<string | null>(null);
  const read = <T,>(key: string, fallback: T): T => getSessionValue<T>(sessionId, key) ?? fallback;

  const activeTab = activeTabOf(tabs, activeTabId);
  const url = tabUrl(activeTab);

  // One reconcile per session, after that session's stored blob has landed:
  // sanitize what was stored, migrate the legacy history into one tab, or seed
  // the first blank tab. Rendering a strip with no active tab is what this
  // prevents.
  useEffect(() => {
    if (!ready || reconciled.current === sessionId) return;
    reconciled.current = sessionId;
    const stored = read<unknown>(TABS_KEY, []);
    const clean = pruneTabs(stored);
    if (clean.length > 0) {
      if (JSON.stringify(clean) !== JSON.stringify(stored)) setTabs(clean);
      const storedActive = read<string | null>(ACTIVE_KEY, null);
      if (!clean.some((tab) => tab.id === storedActive)) setActiveTabId(clean[clean.length - 1]!.id);
      return;
    }
    const [legacy] = pruneTabs([
      {
        id: nextTabId(),
        history: read<unknown>(LEGACY_HISTORY_KEY, []),
        index: read<number>(LEGACY_INDEX_KEY, -1),
        frameKey: 0,
      },
    ]);
    const seed = legacy && legacy.history.length > 0 ? legacy : createTab(nextTabId());
    setTabs([seed]);
    setActiveTabId(seed.id);
    // `read` is a per-render closure over the session id already in the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, sessionId, setTabs, setActiveTabId]);

  const updateTab = useCallback(
    (tabId: string, update: (tab: UserBrowserTab) => UserBrowserTab) => {
      setTabs((prev) => prev.map((tab) => (tab.id === tabId ? update(tab) : tab)));
    },
    [setTabs],
  );

  const submit = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;
      let next: string;
      try {
        next = normalizeUrl(trimmed);
      } catch (normalizeError) {
        setError(normalizeError instanceof Error ? normalizeError.message : 'Alamat tidak valid');
        return;
      }
      setError(undefined);
      setInput(next);
      if (!activeTab) {
        // Nothing restored yet (or every tab was closed): the typed address is
        // the tab. A silent no-op here is an address bar that swallows input.
        const tab = createTab(nextTabId(), next);
        setTabs([tab]);
        setActiveTabId(tab.id);
        setLoadingTabId(tab.id);
        return;
      }
      setLoadingTabId(activeTab.id);
      updateTab(activeTab.id, (tab) => pushAddress(tab, next));
    },
    [activeTab, setActiveTabId, setInput, setTabs, updateTab],
  );

  const goBack = useCallback(() => {
    if (!activeTab || !tabCanGoBack(activeTab)) return;
    setLoadingTabId(activeTab.id);
    updateTab(activeTab.id, (tab) => stepTab(tab, -1));
  }, [activeTab, updateTab]);

  const goForward = useCallback(() => {
    if (!activeTab || !tabCanGoForward(activeTab)) return;
    setLoadingTabId(activeTab.id);
    updateTab(activeTab.id, (tab) => stepTab(tab, 1));
  }, [activeTab, updateTab]);

  const reload = useCallback(() => {
    if (!activeTab || !url) return;
    setLoadingTabId(activeTab.id);
    updateTab(activeTab.id, reloadTab);
  }, [activeTab, url, updateTab]);

  const markLoaded = useCallback((tabId: string) => {
    setLoadingTabId((current) => (current === tabId ? null : current));
  }, []);

  const openTab = useCallback(() => {
    if (tabs.length >= MAX_USER_BROWSER_TABS) return;
    const tab = createTab(nextTabId());
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
    setInput('');
    setError(undefined);
  }, [setActiveTabId, setInput, setTabs, tabs.length]);

  const selectTab = useCallback(
    (tabId: string) => {
      const target = tabs.find((tab) => tab.id === tabId);
      if (!target) return;
      setActiveTabId(tabId);
      // The field belongs to the tab on screen. Without this, switching to a tab
      // with the same URL leaves the previous tab's half-typed address visible.
      setInput(tabUrl(target));
      setError(undefined);
    },
    [setActiveTabId, setInput, tabs],
  );

  const closeTab = useCallback(
    (tabId: string) => {
      const result = closeTabIn(tabs, activeTabId, tabId);
      if (result.tabs.length === 0) {
        // A browser always has a new tab; an empty strip with an address bar
        // that cannot create one is a panel you have to reopen.
        const fresh = createTab(nextTabId());
        setTabs([fresh]);
        setActiveTabId(fresh.id);
        setInput('');
        return;
      }
      setTabs(result.tabs);
      if (result.activeId !== activeTabId) {
        setActiveTabId(result.activeId);
        const next = result.tabs.find((tab) => tab.id === result.activeId);
        setInput(tabUrl(next));
        setError(undefined);
      }
    },
    [activeTabId, setActiveTabId, setInput, setTabs, tabs],
  );

  return {
    tabs,
    activeTab,
    activeTabId: activeTab?.id ?? null,
    url,
    input,
    setInput,
    frameKey: activeTab?.frameKey ?? 0,
    loading: loadingTabId !== null && loadingTabId === activeTab?.id,
    error,
    canGoBack: tabCanGoBack(activeTab),
    canGoForward: tabCanGoForward(activeTab),
    canOpenTab: tabs.length < MAX_USER_BROWSER_TABS,
    submit,
    goBack,
    goForward,
    reload,
    markLoaded,
    openTab,
    selectTab,
    closeTab,
  };
}
