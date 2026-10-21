/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The WAITING half of the pending store.
 *
 * Split from `pending-sessions.ts` for the repo's per-file ceiling, and it is a
 * clean seam: that file owns an entry's LIFETIME (mint, adopt, retain, drop),
 * this one owns the single field that says the chat's prompt is deferred. The
 * store exposes one write hook (`patchPendingEntry`) so the field is still
 * written through the same map, the same emit and the same no-op check.
 */

import type { PendingSessionEntry } from '@/client/hooks/chat/omp/pending-sessions';
import { listPendingSessions, patchPendingEntry } from '@/client/hooks/chat/omp/pending-sessions';

export type PendingWait = NonNullable<PendingSessionEntry['waiting']>;

/**
 * The chat's prompt is held until another session finishes.
 *
 * `sentAt` is set as well, deliberately: the row now stands for a real prompt
 * the user has committed, so the "an unsent draft with nothing in it may go"
 * rule must not reclaim it. The waiting half is what survives the switch —
 * `reconcilePendingSessions` keeps it while the server still reports the row.
 */
export function markPendingSessionWaiting(id: string, waiting: PendingWait): void {
  patchPendingEntry(id, (entry) => ({ ...entry, sentAt: entry.sentAt ?? Date.now(), waiting }));
}

/** The wait ended (dispatched, cancelled, failed): keep the row, drop the cue. */
export function clearPendingSessionWaiting(id: string): void {
  patchPendingEntry(id, (entry) => (entry.waiting ? { ...entry, waiting: undefined } : entry));
}

/** The waiting half of one entry, or null when the row is not waiting. */
export function pendingSessionWait(id: string): PendingWait | null {
  return listPendingSessions().find((entry) => entry.id === id)?.waiting ?? null;
}

/** Drop the entry whose prompt was held by `waitId` (the wait was cancelled). */
export function releasePendingSessionByWait(waitId: string): void {
  for (const entry of listPendingSessions()) {
    if (entry.waiting?.waitId === waitId) patchPendingEntry(entry.id, () => null);
  }
}
