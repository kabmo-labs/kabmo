/**
 * Per-session UI state store (module singleton).
 *
 * UI state that should survive session switches (and full page reloads) is
 * kept here in an in-memory cache keyed by the session id and persisted as
 * one JSON blob per session into the `session_ui_state` SQLite table via
 * `GET/POST /api/sessions/:sessionId/state`. Session ids are the URL
 * `sessionId` param values: numeric in mock mode, omp UUID strings in real
 * mode, plus transient `new-…` ids for pending chats (migrated to the real
 * id on spawn adoption).
 *
 * Key namespace contract (dot-prefixed by owning panel):
 * - workspace.activeRepo      { root, repo } — the selected nested repo, shared
 *                             by the files/search/git/terminal views. Supersedes
 *                             the retired per-panel `<panel>.activeRepo` keys,
 *                             which are migrated on the first open.
 * - layout.activeRightPanel   RightPanelType
 * - layout.showRightPanel     boolean
 * - layout.showLeftPanel      boolean
 * - layout.userToggledEditor  boolean | null (null = follow whether a file is open)
 * - layout.panelWidths        PanelWidths (the editor's and the right panel's
 *                             widths, per session; a session that has never
 *                             been resized has none, so those panels open at
 *                             their defaults). The SIDEBAR is not in here — its
 *                             width is global (`app_settings.omp_sidebar_width`).
 * - layout.openedFiles        editor file entries array
 * - layout.activeFileId       number | null
 * - editor.previewMode        Record<fileId, boolean>
 * - editor.wordWrap           boolean
 * - editor.zoomLevel          number
 * - files.expandedPaths       string[]
 * - files.searchQuery         string
 * - browser.zoomLevel         number
 * - userBrowser.history       string[]
 * - userBrowser.historyIndex  number
 * - userBrowser.inputUrl      string
 * - userBrowser.viewportMode  string
 * - userBrowser.zoomLevel     number
 * - terminal.id               string (server-side PTY id; reattached on reload)
 * - git.viewMode              'flat' | 'tree'
 * - git.commitDraft           string
 * - git.stagedExpanded        boolean
 * - git.unstagedExpanded      boolean
 * - git.expandedFolders       string[]
 * - git.repoQuery             string
 * - search.query              string
 * - search.replaceQuery       string
 * - search.matchCase          boolean
 * - search.wholeWord          boolean
 * - search.useRegex           boolean
 * - search.includeFiles       string
 * - search.showIncludeField   boolean
 * - context.rawExpandedIds    Record<string, boolean>
 * - context.rawFilterRole     'all' | 'assistant' | 'user'
 * - usage.selectedProviderId  'kenari' | 'deepseek'
 * - plan.selectedFile         { sessionId, path } — the plan artifact the Plan
 *                             panel shows, stored with its session so a path
 *                             from another conversation is never restored
 * - chat.draft                string
 * - chat.draftAttachments     attachment metadata array
 */

import { notifySessionKey } from '@/shared/lib/workspace/session-state/listeners';

type SessionState = Record<string, unknown>;

const cache = new Map<string, SessionState>();
/** Epoch ms of the last user-driven access per session (get/set/hydrate). */
const lastTouched = new Map<string, number>();
const dirtySessions = new Map<string, boolean>();
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();

const PERSIST_DEBOUNCE_MS = 600;

// Bounded LRU cache: cap the number of sessions kept in memory so the tab
// doesn't grow unboundedly as the user visits more sessions.
const MAX_CACHED_SESSIONS = 10;
/** A session whose last user access is older than this is evicted regardless
 *  of the size cap, so stale per-session UI state (drafts, panel layouts)
 *  stops occupying memory 10 minutes after the user last opened it. */
const SESSION_IDLE_TTL_MS = 10 * 60 * 1000;

/**
 * Reorder a cache entry to the end of the Map's iteration order (the
 * most-recently-used position) via delete-then-set. Map.set on an existing
 * key updates the value but keeps its original position, so the explicit
 * delete is required for true LRU semantics.
 */
function touchCacheEntry(sessionId: string): void {
  const value = cache.get(sessionId);
  if (value !== undefined) {
    cache.delete(sessionId);
    cache.set(sessionId, value);
  }
  lastTouched.set(sessionId, Date.now());
}

/**
 * Evict the oldest clean sessions until the cache is within bounds.
 *
 * Dirty-safety rule: a session with unsaved writes (`dirtySessions.get(id) ===
 * true`) must never be evicted, or the user's drafts and editor state would be
 * silently lost. If every candidate is dirty (or is the protected id currently
 * being written), stop evicting rather than lose data.
 *
 * Entries idle past SESSION_IDLE_TTL_MS are evicted first — even when the
 * cache is under the size cap — so long-unused sessions drop out on schedule.
 */
function evictIfNeeded(protectedId: string | null): void {
  const now = Date.now();
  const evict = (id: string): void => {
    cache.delete(id);
    dirtySessions.delete(id);
    lastTouched.delete(id);
    const timer = persistTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      persistTimers.delete(id);
    }
  };
  // TTL pass: safe to skip only while the timer still holds the unsaved state
  // or the session is the one currently being written.
  for (const [id, touched] of lastTouched) {
    if (now - touched <= SESSION_IDLE_TTL_MS) continue;
    if (id === protectedId) continue;
    if (dirtySessions.get(id)) continue;
    evict(id);
  }
  while (cache.size > MAX_CACHED_SESSIONS) {
    let evicted = false;
    for (const id of cache.keys()) {
      if (id === protectedId) continue;
      if (dirtySessions.get(id)) continue;
      evict(id);
      evicted = true;
      break;
    }
    if (!evicted) break;
  }
}

export function getSessionValue<T>(sessionId: string | null, key: string): T | undefined {
  if (!sessionId) return undefined;
  touchCacheEntry(sessionId);
  return cache.get(sessionId)?.[key] as T | undefined;
}

export function setSessionKey(sessionId: string | null, key: string, value: unknown): void {
  if (!sessionId) return;
  const state = cache.get(sessionId) ?? {};
  state[key] = value;
  cache.set(sessionId, state);
  touchCacheEntry(sessionId);
  dirtySessions.set(sessionId, true);
  schedulePersist(sessionId);
  evictIfNeeded(sessionId);
  notifySessionKey(sessionId, key);
}

/**
 * Remove a slot outright — for a key a cutover retired, where leaving the old
 * value behind would keep a stale choice visible to anything that still reads
 * it. Absent key: no write, no persist, no notification.
 */
export function clearSessionKey(sessionId: string | null, key: string): void {
  if (!sessionId) return;
  const state = cache.get(sessionId);
  if (!state || !(key in state)) return;
  delete state[key];
  touchCacheEntry(sessionId);
  dirtySessions.set(sessionId, true);
  schedulePersist(sessionId);
  notifySessionKey(sessionId, key);
}

function schedulePersist(sessionId: string): void {
  const existing = persistTimers.get(sessionId);
  if (existing) clearTimeout(existing);
  persistTimers.set(
    sessionId,
    setTimeout(() => {
      persistTimers.delete(sessionId);
      void persistSession(sessionId);
    }, PERSIST_DEBOUNCE_MS),
  );
}

async function persistSession(sessionId: string): Promise<void> {
  if (typeof window === 'undefined' || !sessionId) return;
  if (!dirtySessions.get(sessionId)) return;
  dirtySessions.set(sessionId, false);
  const state = cache.get(sessionId) ?? {};
  try {
    await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    });
  } catch (err) {
    console.warn('session-state persist failed:', err);
    dirtySessions.set(sessionId, true);
  }
}

/** Immediately persist any pending writes for a session (used on switch). */
export function flushSession(sessionId: string | null): Promise<void> {
  if (!sessionId || typeof window === 'undefined') return Promise.resolve();
  const timer = persistTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    persistTimers.delete(sessionId);
  }
  return persistSession(sessionId);
}

/** Fetch a session's stored blob and merge it under any local writes. */
export async function loadSession(sessionId: string): Promise<void> {
  if (!sessionId) return;
  if (typeof window === 'undefined') return;
  try {
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/state`);
    if (res.ok) {
      const data = (await res.json()) as { state?: SessionState };
      const incoming = data.state && typeof data.state === 'object' ? data.state : {};
      const existing = cache.get(sessionId) ?? {};
      // Only keys written locally while the fetch was in flight win over the
      // stored blob. Merging the WHOLE local cache over the blob (the old
      // behavior) resurrected stale values on every tab: a second browser
      // opening the session had cached the pre-write blob, and its stale
      // copy clobbered another tab's fresh writes — queue items written in
      // one tab never appeared in the other.
      const dirty = dirtySessions.get(sessionId) === true;
      const merged = dirty ? { ...incoming, ...existing } : incoming;
      cache.set(sessionId, merged);
      touchCacheEntry(sessionId);
    }
  } catch (err) {
    console.warn('session-state load failed:', err);
  }
  evictIfNeeded(sessionId);
  // The blob replaces every slot at once, so a follower that read the store
  // before it arrived (no pick yet) has to re-read.
  notifySessionKey(sessionId);
}

/** Seed the cache synchronously (e.g. from SSR-provided data). */
export function hydrateSession(sessionId: string | null, state: SessionState): void {
  if (!sessionId) return;
  cache.set(sessionId, { ...(cache.get(sessionId) ?? {}), ...state });
  touchCacheEntry(sessionId);
  evictIfNeeded(sessionId);
  notifySessionKey(sessionId);
}

/**
 * Record that the user opened this session now. Drives the mobile header's
 * recent-session picker and the cache TTL: a session is "recent" only while
 * its last open is within SESSION_IDLE_TTL_MS.
 */
export function recordSessionOpen(sessionId: string | null): void {
  if (sessionId) lastTouched.set(sessionId, Date.now());
}

/** Epoch ms of the user's last open of this session in this tab, if any. */
export function getLastOpenedAt(sessionId: string): number | undefined {
  return lastTouched.get(sessionId);
}

/**
 * Drop a session's cached UI state after it was deleted.
 *
 * Deliberately does NOT persist: the session no longer exists, and the persist
 * endpoint upserts, so flushing here would write the row straight back. The
 * pending debounce timer is cancelled for the same reason — it would fire after
 * the delete and resurrect the state.
 */
export function forgetSession(sessionId: string): void {
  const timer = persistTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    persistTimers.delete(sessionId);
  }
  cache.delete(sessionId);
  dirtySessions.delete(sessionId);
  lastTouched.delete(sessionId);
  notifySessionKey(sessionId);
}

/**
 * Move a pending `new-…` session's state onto the real session id adopted
 * by a spawn, then discard the transient slot.
 */
export function migrateSessionState(fromId: string, toId: string): void {
  const from = cache.get(fromId);
  if (from) cache.set(toId, { ...from, ...(cache.get(toId) ?? {}) });
  touchCacheEntry(toId);
  dirtySessions.set(toId, true);
  schedulePersist(toId);
  cache.delete(fromId);
  dirtySessions.delete(fromId);
  lastTouched.delete(fromId);
  evictIfNeeded(toId);
  // The adopted slot gained the whole transient state; the transient one lost it.
  notifySessionKey(toId);
  notifySessionKey(fromId);
}
