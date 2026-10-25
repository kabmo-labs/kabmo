/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Which copy wins when a session's stored blob arrives.
 *
 * Split out of `store.ts` for the file-size ceiling, and it is a coherent unit
 * rather than an arbitrary cut: both halves answer the same question, and the
 * store is the only caller. The store owns the CACHE (an entry's lifetime, the
 * persist debounce, eviction); this owns the DECISION (a response describes the
 * row as it was when the request arrived, so anything written since is newer).
 */

type SessionState = Record<string, unknown>;

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

/** The counter as of now — a read takes this before it issues its request. */
export function currentWriteSeq(): number {
  return writeSeq;
}

/** Record that `key` was written locally just now. */
export function noteWrite(sessionId: string, key: string): void {
  writeSeq += 1;
  let perSession = writeLog.get(sessionId);
  if (!perSession) {
    perSession = new Map();
    writeLog.set(sessionId, perSession);
  }
  perSession.set(key, writeSeq);
}

/** The keys of `sessionId` written after `since` (strictly later). */
export function keysWrittenAfter(sessionId: string, since: number): Set<string> {
  const written = new Set<string>();
  const perSession = writeLog.get(sessionId);
  if (!perSession) return written;
  for (const [key, seq] of perSession) {
    if (seq > since) written.add(key);
  }
  return written;
}

/** Drop a session's write history — evicted, forgotten or adopted away. */
export function forgetWrites(sessionId: string): void {
  writeLog.delete(sessionId);
}

/**
 * The blob to cache, given the response, the local entry, the keys written
 * while the read was in flight, and whether the entry is still dirty.
 *
 * Only the keys written during the window win over the stored blob. Merging the
 * WHOLE local cache over the blob (the old behavior) resurrected stale values on
 * every tab: a second browser opening the session had cached the pre-write blob,
 * and its stale copy clobbered another tab's fresh writes — queue items written
 * in one tab never appeared in the other.
 */
export function mergeStoredBlob(
  incoming: SessionState,
  existing: SessionState,
  written: Set<string>,
  dirty: boolean,
): SessionState {
  // A dirty entry has a persist that has not landed: the whole local copy is
  // newer than the response.
  if (dirty) return { ...incoming, ...existing };
  if (written.size === 0) return incoming;
  const merged: SessionState = { ...incoming };
  for (const key of written) {
    // A key the local side still holds wins outright; one it no longer holds
    // was CLEARED during the read (`clearSessionKey`), so the response's copy is
    // the stale one and must not resurrect it.
    if (key in existing) merged[key] = existing[key];
    else delete merged[key];
  }
  return merged;
}
