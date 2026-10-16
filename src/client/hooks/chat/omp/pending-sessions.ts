/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The sidebar's PENDING rows: a chat that exists in the client before omp's
 * transcript scan can see it.
 *
 * A session becomes visible to the sidebar when omp writes its `.jsonl`, and
 * omp buffers that write until the first assistant message settles (~17s on a
 * plain prompt). Until then only the client can draw the row — and the client
 * used to derive it from the URL, which made the row exist only while the
 * pending chat was the ACTIVE one (switching away dropped it, and it came back
 * when the scan caught up) and only in the desktop sidebar, the single caller
 * that asked for the placeholder. On a phone a brand-new chat therefore showed
 * no row at all until omp's file landed.
 *
 * This store owns the row instead. It is created by the click, follows the id a
 * spawn adopts, and is dropped the moment the authoritative list carries the
 * session. Both sidebars read the same store, so one chat is one row on either
 * layout, and the row's timestamp comes from the id's own clock rather than
 * `Date.now()` — a re-stamp on every revalidate advanced the title's seconds
 * and made the row perpetually newest (see `pendingSessionTitle`).
 *
 * Retention is four rules, and each is a bug if dropped:
 *
 *   - LISTED wins: the structure's own row is the real thing, so the entry goes;
 *   - a run in flight keeps its row wherever the user navigates;
 *   - a SENT entry outlives the switch, because its transcript is seconds away
 *     — with `PENDING_SETTLE_MS` as the bound, so a child that died before
 *     writing one cannot leave a row behind for the life of the tab;
 *   - an UNSENT draft keeps its row only while there IS a draft to get back to
 *     (`hasUnsavedDraft`), because the row was derived from `?sessionId=` and
 *     switching sessions deleted a chat the user had just opened. Its content
 *     is real — the draft lives in that session's UI state — so the row is what
 *     makes the draft reachable again. A chat opened and left EMPTY has no
 *     content, so its row goes with the switch: the unconditional version of
 *     this rule turned every stray New Session click into a permanent sidebar
 *     entry with nothing behind it. `MAX_UNSENT_DRAFTS` remains the bound on
 *     how many real drafts are held at once.
 */

import { useEffect, useState } from 'preact/hooks';
import { pendingSessionCreatedAt, sessionIdEpochMs } from '@/shared/lib/omp/session/default-title';
import { getSessionState } from '@/shared/lib/workspace/session-state/store';
import { hasComposerDraft } from '@/shared/lib/chat/composer/draft';

export interface PendingSessionEntry {
  /** Client-side `new-<epoch>` id, or the omp UUID a spawn adopted. */
  id: string;
  /** The folder the row belongs to; null resolves from the active session. */
  folderId: number | string | null;
  /** Epoch ms the chat was started — stable across adoption and reloads, so
   *  neither the title nor the ordering can churn on a revalidate. */
  createdAt: number;
  /** Epoch ms a prompt was dispatched for this chat, or null while it is a
   *  draft the user has not sent in. */
  sentAt: number | null;
}

/** How long a SENT entry may outlive its switch with no real row behind it.
 *  Measured against omp's own write (buffered until the first assistant message
 *  settles, ~17s), so it is set comfortably past that. */
export const PENDING_SETTLE_MS = 30_000;

/** Unsent drafts kept at once; older ones are dropped as new ones start. */
export const MAX_UNSENT_DRAFTS = 3;

const entries = new Map<string, PendingSessionEntry>();
/** `toId → fromId` for a spawn adoption, consumed by the session-state
 *  provider so a plain switch away from a pending chat cannot be mistaken for
 *  one. Bounded by the pending store itself: an entry is written where an
 *  adoption happens and dropped the moment it is claimed. */
const adoptions = new Map<string, string>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

/** The id's own creation clock: a pending epoch, else a v7 prefix, else now. */
function createdAtFor(id: string): number {
  const pending = pendingSessionCreatedAt(id);
  if (Number.isFinite(pending)) return pending;
  const v7 = sessionIdEpochMs(id);
  return Number.isFinite(v7) ? v7 : Date.now();
}

/** Write an entry, emitting only when it actually moved. */
function upsert(entry: PendingSessionEntry): void {
  const current = entries.get(entry.id);
  if (
    current
    && current.folderId === entry.folderId
    && current.createdAt === entry.createdAt
    && current.sentAt === entry.sentAt
  ) {
    return;
  }
  entries.set(entry.id, entry);
  emit();
}

/**
 * Start a chat: mint its client-side id and register its row.
 *
 * The id is what the URL carries (`?sessionId=new-…`) until a spawn adopts a
 * real one, so the caller writes the returned value rather than minting its own
 * — an id the store does not know is a row nothing can draw.
 */
export function startPendingSession(folderId: number | string | null): string {
  // `new-<epochMs>` stays parseable by `pendingSessionCreatedAt`, which is what
  // keeps the row's title and stamp still across revalidates — so two clicks in
  // the same millisecond step the clock instead of gaining a suffix, which
  // would read as `NaN` and fall back to `new Date()`.
  let epoch = Date.now();
  while (entries.has(`new-${epoch}`)) epoch += 1;
  const id = `new-${epoch}`;
  upsert({ id, folderId, createdAt: epoch, sentAt: null });
  // Repeated New Session clicks are the one way this map grows without a
  // bound: each click is a row the user may never send in. Oldest drafts go,
  // and a SENT entry is never a candidate — its transcript is on the way.
  const drafts = [...entries.values()].filter((entry) => entry.sentAt === null);
  for (const stale of drafts.slice(0, Math.max(0, drafts.length - MAX_UNSENT_DRAFTS))) {
    entries.delete(stale.id);
  }
  return id;
}

/** A prompt was dispatched for this chat: its row now outlives a switch. */
export function markPendingSessionSent(id: string): void {
  const entry = entries.get(id);
  if (!entry || entry.sentAt !== null) return;
  upsert({ ...entry, sentAt: Date.now() });
}

/**
 * Move the entry onto the id a spawn adopted, so the row survives the
 * `new-…` → omp-UUID switch.
 *
 * An unknown source still gets an entry: the scope can carry no pending id at
 * all (a send with no `?sessionId=`), and the spawned session is exactly as
 * unscanned as a clicked one.
 */
export function adoptPendingSession(
  fromId: string | null | undefined,
  toId: string,
  folderId?: number | string | null,
): void {
  if (!toId) return;
  const from = fromId ? entries.get(fromId) : undefined;
  if (from && fromId) entries.delete(fromId);
  // Recorded for the session-state provider, which must NOT carry the pending
  // slot's UI state onto just any id the URL moves to — only onto the one a
  // spawn answered with. See `consumeAdoption`.
  if (fromId) adoptions.set(toId, fromId);
  upsert({
    id: toId,
    folderId: from?.folderId ?? folderId ?? null,
    createdAt: from?.createdAt ?? createdAtFor(toId),
    sentAt: from?.sentAt ?? Date.now(),
  });
}

/**
 * Whether `toId` is the id a spawn answered with for `fromId` — consuming the
 * record so one adoption is claimed once.
 *
 * The session-state provider used to treat EVERY move away from a `new-…` id as
 * an adoption and migrate the transient slot's whole UI state onto whatever the
 * URL now named. Clicking another session from a pending chat is the same
 * transition, so the pending chat's DRAFT was copied into that session and
 * persisted there (measured: a POST for the other session carrying
 * `chat.draft`). Only a real spawn may carry the state across.
 */
export function consumeAdoption(fromId: string | null | undefined, toId: string): boolean {
  if (!fromId || adoptions.get(toId) !== fromId) return false;
  adoptions.delete(toId);
  return true;
}

/**
 * Register an id the URL names but this store does not know.
 *
 * The URL is the other way a pending chat exists: a reload (or a second tab)
 * re-enters `?sessionId=new-…` with an empty store, and an adopted id whose
 * transcript omp has not written yet is unscanned the same way. `running` is
 * what keeps a reloaded mid-run chat's row after a switch — the status map
 * already reports the run, so the row must not depend on the URL for it.
 */
export function hydratePendingSession(
  id: string,
  folderId: number | string | null,
  running: boolean,
): void {
  if (!id || entries.has(id)) return;
  upsert({ id, folderId, createdAt: createdAtFor(id), sentAt: running ? Date.now() : null });
}

/** Drop an entry (a released draft, a session that went away). */
export function releasePendingSession(id: string): void {
  if (entries.delete(id)) emit();
}

/** The entries, in creation order. */
export function listPendingSessions(): PendingSessionEntry[] {
  return [...entries.values()];
}

/** Drop the entries the authoritative list has superseded, plus stale sends. */
export function reconcilePendingSessions(input: {
  /** Session ids the structure's own payload carries. */
  listed: Set<string>;
  /** Ids whose run is in flight (the sidebar's `stream` rows). */
  running: Set<string>;
  /** The session the URL has open, if any: its own row is never dropped here —
   *  it is the row the user is looking at, whatever it holds. */
  activeId?: string | null;
  /** Clock override, so a test can age a sent entry past its grace. */
  now?: number;
}): void {
  const now = input.now ?? Date.now();
  const active = input.activeId ? String(input.activeId) : null;
  let changed = false;
  for (const [id, entry] of [...entries]) {
    // The structure's own row is the real thing — the pending entry existed
    // only to stand in for it.
    if (input.listed.has(id)) {
      entries.delete(id);
      changed = true;
      continue;
    }
    // A live run holds its row wherever the user navigates: the spinner and
    // the row it belongs to are the same fact.
    if (input.running.has(id)) continue;
    if (entry.sentAt !== null) {
      if (now - entry.sentAt > PENDING_SETTLE_MS) {
        entries.delete(id);
        changed = true;
      }
      continue;
    }
    // An UNSENT draft keeps its row only while there IS a draft to get back to.
    // The row used to be unconditional, which made every stray New Session
    // click — open, type nothing, click another session — a permanent entry in
    // the sidebar with nothing behind it. What must survive is the CONTENT: a
    // chat the user typed into and walked away from still has its text in that
    // session's UI state, and the row is the only way back to it.
    if (active !== null && String(id) === active) continue;
    if (!hasComposerDraft(getSessionState(id))) {
      entries.delete(id);
      changed = true;
    }
  }
  if (changed) emit();
}

export function subscribePendingSessions(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The pending entries, reactive.
 *
 * `useState` + `subscribe` rather than `useSyncExternalStore`, for the reason
 * `renaming-sessions.ts` gives: the store is a Map every sidebar re-reads, so
 * there is no single snapshot identity an external store could compare.
 */
export function usePendingSessions(): PendingSessionEntry[] {
  const [snapshot, setSnapshot] = useState<PendingSessionEntry[]>(() => listPendingSessions());
  useEffect(() => {
    setSnapshot(listPendingSessions());
    return subscribePendingSessions(() => setSnapshot(listPendingSessions()));
  }, []);
  return snapshot;
}
