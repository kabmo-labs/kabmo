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
 * - editor.scrollPositions    ScrollPositions — where each editor tab was left
 *                             scrolled, per surface (`code`/`rendered` for a
 *                             file tab, `unified`/`split` for a diff). A tab at
 *                             the top carries no entry, and an entry is dropped
 *                             where its tab closes. The phone editor has its own
 *                             slot (`editor.mobileScrollPositions`, keyed by
 *                             path), because the desktop column is keyed by tab
 *                             id and drops entries against those ids.
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

import { notifySessionKey, notifySessionReplaced } from '@/shared/lib/workspace/session-state/listeners';

type SessionState = Record<string, unknown>;

const cache = new Map<string, SessionState>();
/** Epoch ms of the last user-driven access per session (get/set/hydrate). */
const lastTouched = new Map<string, number>();
const dirtySessions = new Map<string, boolean>();
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * A monotonic counter bumped by every local write, and the counter value each
 * `(session, key)` was last written at.
 *
 * This exists for ONE race, and `dirtySessions` cannot cover it: a load's
 * response is served from a snapshot taken when the request arrived, while a
 * write made in the meantime persists on its own schedule. Once that persist
 * succeeds the dirty flag is cleared — so a response that arrives after it but
 * was computed before it would be adopted as-is and silently drop the write.
 * Measured in the browser (a rare e2e failure, `outline.e2e.ts`): a file opened
 * while the page's first `/state` read was in flight came back with
 * `layout.openedFiles` gone, so the editor drew "Select a file to open" over a
 * file the user had just clicked.
 *
 * `loadSession` records the counter when it STARTS and merges exactly the keys
 * written after that point, which is what makes "wrote it while the read was in
 * flight" survive regardless of when the persist landed.
 */
let writeSeq = 0;
const writeLog = new Map<string, Map<string, number>>();

/** Record that `key` was written locally just now. */
function noteWrite(sessionId: string, key: string): void {
  writeSeq += 1;
  let perSession = writeLog.get(sessionId);
  if (!perSession) {
    perSession = new Map();
    writeLog.set(sessionId, perSession);
  }
  perSession.set(key, writeSeq);
}

/** The keys of `sessionId` written after `since` (strictly later). */
function keysWrittenAfter(sessionId: string, since: number): Set<string> {
  const written = new Set<string>();
  const perSession = writeLog.get(sessionId);
  if (!perSession) return written;
  for (const [key, seq] of perSession) {
    if (seq > since) written.add(key);
  }
  return written;
}

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
    writeLog.delete(id);
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

/**
 * A session's whole UI-state entry, or `undefined` when this tab has not read
 * it yet.
 *
 * The distinction matters to a reader that must tell "the stored blob says
 * there is nothing" apart from "the answer is still unknown": `loadSession`
 * seeds an entry (even an empty one) the moment the fetch settles, so an
 * ABSENT entry is a pending read, not a negative answer. Returns the live entry
 * as READ-ONLY — write through `setSessionKey` so the persist debounce and the
 * change notification stay on one path.
 */
export function getSessionState(sessionId: string | null): Readonly<Record<string, unknown>> | undefined {
  if (!sessionId) return undefined;
  return cache.get(sessionId);
}

export function setSessionKey(sessionId: string | null, key: string, value: unknown): void {
  if (!sessionId) return;
  const state = cache.get(sessionId) ?? {};
  state[key] = value;
  cache.set(sessionId, state);
  touchCacheEntry(sessionId);
  dirtySessions.set(sessionId, true);
  noteWrite(sessionId, key);
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
  // A DELETE is a write: a blob that still carries the key must not bring it
  // back (a retired key cleared on this side would return from the other tab's
  // older snapshot).
  noteWrite(sessionId, key);
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
  /**
   * The write counter as of the moment the read STARTED.
   *
   * Everything written after this is newer than the response, because the
   * response describes the row as it was when the request arrived. Two
   * mechanisms are needed and neither is sufficient alone: `dirtySessions`
   * covers a write whose persist has not landed yet, while this covers one that
   * already persisted — at which point the dirty flag is clear and a stale
   * response would otherwise be adopted wholesale. Measured: a file opened
   * during the first `/state` read came back with `layout.openedFiles` gone.
   */
  const startedAt = writeSeq;
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
      const written = keysWrittenAfter(sessionId, startedAt);
      const dirty = dirtySessions.get(sessionId) === true;
      let merged: SessionState;
      if (dirty) {
        merged = { ...incoming, ...existing };
      } else if (written.size > 0) {
        merged = { ...incoming };
        for (const key of written) {
          // A key the local side still holds wins outright; one it no longer
          // holds was CLEARED during the read (`clearSessionKey`), so the
          // response's copy is the stale one and must not resurrect it.
          if (key in existing) merged[key] = existing[key];
          else delete merged[key];
        }
      } else {
        merged = incoming;
      }
      cache.set(sessionId, merged);
      touchCacheEntry(sessionId);
    }
  } catch (err) {
    console.warn('session-state load failed:', err);
  }
  evictIfNeeded(sessionId);
  // The blob replaces every slot at once, so a follower that read the store
  // before it arrived (no pick yet) has to re-read — including a private copy
  // held by `useSessionState`, which does not follow per-slot writes.
  notifySessionKey(sessionId);
  notifySessionReplaced(sessionId);
}

/** Seed the cache synchronously (e.g. from SSR-provided data). */
export function hydrateSession(sessionId: string | null, state: SessionState): void {
  if (!sessionId) return;
  cache.set(sessionId, { ...(cache.get(sessionId) ?? {}), ...state });
  touchCacheEntry(sessionId);
  evictIfNeeded(sessionId);
  notifySessionKey(sessionId);
  notifySessionReplaced(sessionId);
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
  writeLog.delete(sessionId);
  notifySessionKey(sessionId);
  notifySessionReplaced(sessionId);
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
  writeLog.delete(fromId);
  evictIfNeeded(toId);
  // The adopted slot gained the whole transient state; the transient one lost it.
  notifySessionKey(toId);
  notifySessionKey(fromId);
  // Both entries were REPLACED, not written slot by slot. `ready` does not
  // change across an adoption (it was already true for the pending id), so
  // without this a private copy kept the fallback it read on the commit the
  // URL moved — the reported "opening panels in a new chat and sending the
  // first prompt closes them all".
  notifySessionReplaced(toId);
  notifySessionReplaced(fromId);
}
