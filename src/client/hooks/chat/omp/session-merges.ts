/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The three MERGES the session list performs on a server snapshot, split out of
 * `session-list.tsx` so the provider stays under the repo's size ceiling.
 *
 * Each one is a pure folder array in, folder array out, and each has the same
 * contract: return the SAME array when nothing moved. That identity is what the
 * sidebar's memo chain (filter, sort, pending overlay) keys on — returning a
 * fresh array per activity frame re-sorted 731 rows for a stamp that had not
 * changed.
 */

import type { WorkspaceFolderData } from '@/shared/types';
import type { SidebarActivityPayload, SidebarStatusPayload } from '@/shared/types/realtime';

/** Merge a structure payload with the volatile map, by session id. */
export function mergeStatus(
  folders: WorkspaceFolderData[],
  status: SidebarStatusPayload | null,
): WorkspaceFolderData[] {
  if (!status) return folders;
  return folders.map((folder) => ({
    ...folder,
    sessions: (folder.sessions ?? []).map((session) => {
      const volatile = status[String(session.id)];
      return volatile ? { ...session, ...volatile } : session;
    }),
  }));
}

/**
 * Advance each row's live fields from the activity payload.
 *
 * `sidebar:activity` carries only the RUNNING sessions (see its doc), so an id
 * it does not name keeps whatever the structure gave it. Three rules, each of
 * which is a way this can go wrong:
 *
 *   - the `updated_at` comparison is what makes two sources safe to
 *     interleave: the structure is re-scanned at every turn boundary and may
 *     already carry a stamp this payload has not caught up with, and a late
 *     activity frame must never move a row BACKWARDS (that reorders the
 *     sidebar under the reader);
 *   - `hasSubagents` only ever turns ON, because the payload is a live read of
 *     what is on disk and a subagent transcript does not disappear when its run
 *     ends — a `false` here is "not seen yet", not "none exist";
 *   - nothing else is touched. Every other field of a row changes on a
 *     STRUCTURAL event, and those publish the structure for their own reason.
 */
export function mergeActivity(
  folders: WorkspaceFolderData[],
  activity: SidebarActivityPayload | null,
): WorkspaceFolderData[] {
  if (!activity) return folders;
  let changed = false;
  const merged = folders.map((folder) => ({
    ...folder,
    sessions: (folder.sessions ?? []).map((session) => {
      const live = activity[String(session.id)];
      if (!live) return session;
      const updated_at = live.updatedAt && isNewerStamp(live.updatedAt, session.updated_at)
        ? live.updatedAt
        : session.updated_at;
      const hasSubagents = session.hasSubagents || live.hasSubagents === true;
      if (updated_at === session.updated_at && hasSubagents === Boolean(session.hasSubagents)) return session;
      changed = true;
      return { ...session, updated_at, hasSubagents };
    }),
  }));
  // A stable identity matters: the sidebar's own `useMemo` chain (filter, sort,
  // pending overlay) keys on this array, and returning a fresh one per activity
  // frame would re-sort 731 rows for a stamp that did not move.
  return changed ? merged : folders;
}

/** Whether `next` is a later ISO stamp than `current`. An absent current is older. */
export function isNewerStamp(next: string, current?: string): boolean {
  if (!current) return true;
  const nextMs = Date.parse(next);
  const currentMs = Date.parse(current);
  // An unparseable value on either side is not evidence of a newer stamp; the
  // structure's own field stays authoritative.
  if (!Number.isFinite(nextMs) || !Number.isFinite(currentMs)) return false;
  return nextMs > currentMs;
}

