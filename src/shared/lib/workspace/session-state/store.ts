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
 *
 * The module is three files, because one had passed the per-file ceiling: this
 * one owns the PUBLIC API (read, write, load, migrate) and what a write means;
 * `cache.ts` owns the storage (the maps, the LRU order, the idle TTL, the dirty
 * flag); `merge.ts` owns the write counter and the "which copy wins when a blob
 * lands" decision. The maps live only in `cache.ts`, so "is this session dirty"
 * and "drop this session" cannot be answered from two places that disagree.
 */

import { notifySessionKey, notifySessionReplaced } from '@/shared/lib/workspace/session-state/listeners';
import {
  clearDirty,
  dropEntry,
  dropPersistTimer,
  entryForWrite,
  evictIfNeeded,
  isDirty,
  lastAccess,
  markDirty,
  readEntry,
  setPersistTimer,
  stampAccess,
  touchEntry,
  writeEntry,
} from '@/shared/lib/workspace/session-state/cache';
import {
  currentWriteSeq,
  forgetWrites,
  keysWrittenAfter,
  mergeStoredBlob,
  noteWrite,
} from '@/shared/lib/workspace/session-state/merge';

type SessionState = Record<string, unknown>;

const PERSIST_DEBOUNCE_MS = 600;

/** Evict past the cap, dropping this session's write history with it. */
function evictNow(protectedId: string | null): void {
  evictIfNeeded(protectedId, forgetWrites);
}

export function getSessionValue<T>(sessionId: string | null, key: string): T | undefined {
  if (!sessionId) return undefined;
  touchEntry(sessionId);
  return readEntry(sessionId)?.[key] as T | undefined;
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
  return readEntry(sessionId);
}

export function setSessionKey(sessionId: string | null, key: string, value: unknown): void {
  if (!sessionId) return;
  // Mutated IN PLACE, never copied: `useSessionState` compares the store's entry
  // against its own copy by IDENTITY to decide whether a fresher write exists,
  // and a copy per write made every reader see a different object for one slot.
  entryForWrite(sessionId)[key] = value;
  touchEntry(sessionId);
  markDirty(sessionId);
  noteWrite(sessionId, key);
  schedulePersist(sessionId);
  evictNow(sessionId);
  notifySessionKey(sessionId, key);
}

/**
 * Remove a slot outright — for a key a cutover retired, where leaving the old
 * value behind would keep a stale choice visible to anything that still reads
 * it. Absent key: no write, no persist, no notification.
 */
export function clearSessionKey(sessionId: string | null, key: string): void {
  if (!sessionId) return;
  const state = readEntry(sessionId);
  if (!state || !(key in state)) return;
  delete (state as SessionState)[key];
  touchEntry(sessionId);
  markDirty(sessionId);
  // A DELETE is a write: a blob that still carries the key must not bring it
  // back (a retired key cleared on this side would return from the other tab's
  // older snapshot).
  noteWrite(sessionId, key);
  schedulePersist(sessionId);
  notifySessionKey(sessionId, key);
}

function schedulePersist(sessionId: string): void {
  dropPersistTimer(sessionId);
  setPersistTimer(
    sessionId,
    setTimeout(() => {
      dropPersistTimer(sessionId);
      void persistSession(sessionId);
    }, PERSIST_DEBOUNCE_MS),
  );
}

async function persistSession(sessionId: string): Promise<void> {
  if (typeof window === 'undefined' || !sessionId) return;
  if (!isDirty(sessionId)) return;
  clearDirty(sessionId);
  const state = readEntry(sessionId) ?? {};
  try {
    await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    });
  } catch (err) {
    console.warn('session-state persist failed:', err);
    markDirty(sessionId);
  }
}

/** Immediately persist any pending writes for a session (used on switch). */
export function flushSession(sessionId: string | null): Promise<void> {
  if (!sessionId || typeof window === 'undefined') return Promise.resolve();
  dropPersistTimer(sessionId);
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
  const startedAt = currentWriteSeq();
  try {
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/state`);
    if (res.ok) {
      const data = (await res.json()) as { state?: SessionState };
      const incoming = data.state && typeof data.state === 'object' ? data.state : {};
      const existing = readEntry(sessionId) ?? {};
      writeEntry(
        sessionId,
        mergeStoredBlob(incoming, existing, keysWrittenAfter(sessionId, startedAt), isDirty(sessionId)),
      );
      touchEntry(sessionId);
    }
  } catch (err) {
    console.warn('session-state load failed:', err);
  }
  evictNow(sessionId);
  // The blob replaces every slot at once, so a follower that read the store
  // before it arrived (no pick yet) has to re-read — including a private copy
  // held by `useSessionState`, which does not follow per-slot writes.
  notifySessionKey(sessionId);
  notifySessionReplaced(sessionId);
}

/** Seed the cache synchronously (e.g. from SSR-provided data). */
export function hydrateSession(sessionId: string | null, state: SessionState): void {
  if (!sessionId) return;
  writeEntry(sessionId, { ...(readEntry(sessionId) ?? {}), ...state });
  touchEntry(sessionId);
  evictNow(sessionId);
  notifySessionKey(sessionId);
  notifySessionReplaced(sessionId);
}

/**
 * Record that the user opened this session now. Drives the mobile header's
 * recent-session picker and the cache TTL: a session is "recent" only while
 * its last open is within SESSION_IDLE_TTL_MS.
 */
export function recordSessionOpen(sessionId: string | null): void {
  if (sessionId) stampAccess(sessionId);
}

/** Epoch ms of the user's last open of this session in this tab, if any. */
export function getLastOpenedAt(sessionId: string): number | undefined {
  return lastAccess(sessionId);
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
  dropEntry(sessionId);
  forgetWrites(sessionId);
  notifySessionKey(sessionId);
  notifySessionReplaced(sessionId);
}

/**
 * Move a pending `new-…` session's state onto the real session id adopted
 * by a spawn, then discard the transient slot.
 */
export function migrateSessionState(fromId: string, toId: string): void {
  const from = readEntry(fromId);
  if (from) writeEntry(toId, { ...from, ...(readEntry(toId) ?? {}) });
  touchEntry(toId);
  markDirty(toId);
  schedulePersist(toId);
  dropEntry(fromId);
  forgetWrites(fromId);
  evictNow(toId);
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
