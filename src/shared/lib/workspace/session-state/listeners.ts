/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Who is watching a session-state slot.
 *
 * `useSessionState` hands every caller a private copy, so two components reading
 * the same key never observe each other's writes — right for state a component
 * owns alone (a draft, a panel width), wrong for a surface that must FOLLOW a
 * value it does not own (the Source Control dot tracking the repo the git panel
 * picked, the phone's tab bar). Those subscribe here and re-read through
 * `getSessionValue`; the store publishes on every write — `setSessionKey`, a
 * blob arriving, a migrate, a delete.
 *
 * Separate from the store so both modules stay readable: this is a plain
 * observer bus with no notion of what a slot holds.
 */

/** Listeners per session, then per slot (`ALL_SLOTS` = every slot of it). */
const listeners = new Map<string, Map<string, Set<() => void>>>();

/**
 * Listeners for a session's blob being REPLACED wholesale (a fetch landing, a
 * spawn-adoption migrate, a delete) — not for one slot being written.
 *
 * Separate from the per-slot bus because the two mean different things to a
 * private copy. `useSessionState` hands every caller its own `useState`, which
 * deliberately does not follow another component's writes to the same key; but
 * a replacement invalidates the copy outright (the store now holds different
 * state for the whole session), so a reader must re-read or it keeps rendering
 * a stale — often fallback — value forever.
 */
const replacedListeners = new Map<string, Set<() => void>>();

/** Bucket name for a listener that follows every slot of a session. */
const ALL_SLOTS = '*';

/**
 * Listen for writes to one slot of one session, from ANY component.
 *
 * `key` omitted listens to every slot of the session (what a blob arriving
 * changes at once). Returns the unsubscribe.
 */
export function subscribeSessionKey(sessionId: string | null, key: string | null, listener: () => void): () => void {
  if (!sessionId) return () => {};
  const slot = key ?? ALL_SLOTS;
  let slots = listeners.get(sessionId);
  if (!slots) {
    slots = new Map();
    listeners.set(sessionId, slots);
  }
  let bucket = slots.get(slot);
  if (!bucket) {
    bucket = new Set();
    slots.set(slot, bucket);
  }
  bucket.add(listener);
  return () => {
    bucket.delete(listener);
    if (bucket.size === 0) slots.delete(slot);
    if (slots.size === 0) listeners.delete(sessionId);
  };
}

/** Fire one bucket, tolerating listeners that unsubscribe while notified. */
function notifyBucket(bucket: Set<() => void> | undefined): void {
  if (!bucket) return;
  for (const listener of [...bucket]) listener();
}

/**
 * Listen for this session's blob being replaced wholesale. Returns the
 * unsubscribe.
 */
export function subscribeSessionReplaced(sessionId: string | null, listener: () => void): () => void {
  if (!sessionId) return () => {};
  let bucket = replacedListeners.get(sessionId);
  if (!bucket) {
    bucket = new Set();
    replacedListeners.set(sessionId, bucket);
  }
  bucket.add(listener);
  return () => {
    bucket.delete(listener);
    if (bucket.size === 0) replacedListeners.delete(sessionId);
  };
}

/** Announce that this session's whole blob changed under its readers. */
export function notifySessionReplaced(sessionId: string): void {
  const bucket = replacedListeners.get(sessionId);
  if (!bucket) return;
  for (const listener of [...bucket]) listener();
}

/** Fire the listeners of one slot, or of every slot when `key` is omitted. */
export function notifySessionKey(sessionId: string, key?: string): void {
  const slots = listeners.get(sessionId);
  if (!slots) return;
  if (key === undefined) {
    for (const bucket of [...slots.values()]) notifyBucket(bucket);
    return;
  }
  notifyBucket(slots.get(key));
  notifyBucket(slots.get(ALL_SLOTS));
}
