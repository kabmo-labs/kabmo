/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The session-state cache: which entries are held, and for how long.
 *
 * Split out of `store.ts` for the file-size ceiling, and it is the natural seam
 * rather than an arbitrary cut. `store.ts` owns the PUBLIC API (read, write,
 * load, migrate) and the decisions about what a write means; this owns the
 * STORAGE — the maps, the LRU order, the idle TTL, and the dirty flag that says
 * an entry holds writes no persist has carried yet.
 *
 * The maps live here and nowhere else, so "is this session dirty" and "drop this
 * session" cannot be answered from two places that disagree.
 */

type SessionState = Record<string, unknown>;

const entries = new Map<string, SessionState>();
/** Epoch ms of the last user-driven access per session (get/set/hydrate). */
const lastTouched = new Map<string, number>();
/** A session with writes no persist has carried yet. */
const dirty = new Map<string, boolean>();
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Bounded LRU cache: cap the number of sessions kept in memory so the tab
// doesn't grow unboundedly as the user visits more sessions.
const MAX_CACHED_SESSIONS = 10;
/** A session whose last user access is older than this is evicted regardless
 *  of the size cap, so stale per-session UI state (drafts, panel layouts)
 *  stops occupying memory 10 minutes after the user last opened it. */
const SESSION_IDLE_TTL_MS = 10 * 60 * 1000;

/** The cached entry, as read-only — write through the store's own setters. */
export function readEntry(sessionId: string): Readonly<SessionState> | undefined {
  return entries.get(sessionId);
}

/**
 * Reorder a cache entry to the end of the Map's iteration order (the
 * most-recently-used position) via delete-then-set. Map.set on an existing
 * key updates the value but keeps its original position, so the explicit
 * delete is required for true LRU semantics.
 */
export function touchEntry(sessionId: string): void {
  const value = entries.get(sessionId);
  if (value !== undefined) {
    entries.delete(sessionId);
    entries.set(sessionId, value);
  }
  lastTouched.set(sessionId, Date.now());
}

/** Stamp the entry as most-recently-used without reordering it. */
export function stampAccess(sessionId: string): void {
  lastTouched.set(sessionId, Date.now());
}

export function lastAccess(sessionId: string): number | undefined {
  return lastTouched.get(sessionId);
}

/** Replace an entry outright (a blob arriving, a migrate, a hydrate). */
export function writeEntry(sessionId: string, state: SessionState): void {
  entries.set(sessionId, state);
}

/**
 * The MUTABLE entry for a write, created on demand.
 *
 * `setSessionKey` and `clearSessionKey` mutate the cached object in place, as
 * they always have: a copy per write would give every reader a different object
 * for the same slot, and `useSessionState` compares the store's entry against
 * its own copy by IDENTITY to decide whether a fresher write exists.
 */
export function entryForWrite(sessionId: string): SessionState {
  const existing = entries.get(sessionId);
  if (existing) return existing;
  const created: SessionState = {};
  entries.set(sessionId, created);
  return created;
}

/** Mark a session as holding writes no persist has carried yet. */
export function markDirty(sessionId: string): void {
  dirty.set(sessionId, true);
}

export function clearDirty(sessionId: string): void {
  dirty.set(sessionId, false);
}

export function isDirty(sessionId: string): boolean {
  return dirty.get(sessionId) === true;
}

export function setPersistTimer(sessionId: string, timer: ReturnType<typeof setTimeout>): void {
  persistTimers.set(sessionId, timer);
}

export function persistTimer(sessionId: string): ReturnType<typeof setTimeout> | undefined {
  return persistTimers.get(sessionId);
}

export function dropPersistTimer(sessionId: string): void {
  const timer = persistTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    persistTimers.delete(sessionId);
  }
}

/** Remove an entry and everything recorded about it. */
export function dropEntry(sessionId: string): void {
  entries.delete(sessionId);
  dirty.delete(sessionId);
  lastTouched.delete(sessionId);
  dropPersistTimer(sessionId);
}

/**
 * Evict the oldest clean sessions until the cache is within bounds.
 *
 * Dirty-safety rule: a session with unsaved writes (`isDirty`) must never be
 * evicted, or the user's drafts and editor state would be silently lost. If
 * every candidate is dirty (or is the protected id currently being written),
 * stop evicting rather than lose data.
 *
 * Entries idle past SESSION_IDLE_TTL_MS are evicted first — even when the
 * cache is under the size cap — so long-unused sessions drop out on schedule.
 */
export function evictIfNeeded(protectedId: string | null, onEvict: (sessionId: string) => void): void {
  const now = Date.now();
  const evict = (id: string): void => {
    dropEntry(id);
    onEvict(id);
  };
  // TTL pass: safe to skip only while the timer still holds the unsaved state
  // or the session is the one currently being written.
  for (const [id, touched] of lastTouched) {
    if (now - touched <= SESSION_IDLE_TTL_MS) continue;
    if (id === protectedId) continue;
    if (isDirty(id)) continue;
    evict(id);
  }
  while (entries.size > MAX_CACHED_SESSIONS) {
    let evicted = false;
    for (const id of entries.keys()) {
      if (id === protectedId) continue;
      if (isDirty(id)) continue;
      evict(id);
      evicted = true;
      break;
    }
    if (!evicted) break;
  }
}
