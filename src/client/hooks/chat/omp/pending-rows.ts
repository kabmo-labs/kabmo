/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Folding the pending rows into the sidebar's folders.
 *
 * Split from the store that owns them (`pending-sessions.ts`): the store's
 * subject is an entry's LIFETIME, this module's is how one is DRAWN. Both
 * layouts read the same function, so a row is one row on a desktop and on a
 * phone, and the row's host folder is forced open because a row the user cannot
 * see is not a row.
 */

import type { SessionItemData, WorkspaceFolderData } from '@/shared/types';
import { pendingSessionTitle } from '@/shared/lib/omp/session/default-title';
import type { PendingSessionEntry } from '@/client/hooks/chat/omp/pending-sessions';

export interface PendingRowOptions {
  /** The session the URL has open; its folder is the fallback host. */
  activeId: string | null;
  /** `?folderId=`, the last resort before the first folder. */
  urlFolderId?: string | null;
  /** The title hint the send path published for a session omp cannot name. */
  titleFor?: (id: string) => string | undefined;
}

/**
 * Fold the pending entries into the sidebar's folders as real rows.
 *
 * Returns the SAME array when there is nothing to add, so an idle sidebar does
 * not re-render on every store notification. The row lands at the TOP of its
 * folder — it is the newest activity there, which is the ordering the server
 * payload already uses — and the host folder is forced open (desktop reads
 * `isExpanded` from the folder; the phone seeds its expansion from the same
 * list).
 */
export function withPendingRows(
  folders: WorkspaceFolderData[],
  entries: PendingSessionEntry[],
  options: PendingRowOptions,
): WorkspaceFolderData[] {
  if (entries.length === 0 || folders.length === 0) return folders;

  const listed = new Set<string>();
  for (const folder of folders) {
    for (const session of folder.sessions ?? []) listed.add(String(session.id));
  }
  const missing = entries.filter((entry) => !listed.has(String(entry.id)));
  if (missing.length === 0) return folders;

  let result = folders;
  for (const entry of missing) {
    const target = resolvePendingFolder(result, entry, options);
    if (!target) continue;
    const stamp = new Date(entry.createdAt).toISOString();
    const row: SessionItemData = {
      id: entry.id,
      folder_id: target.id,
      title: options.titleFor?.(String(entry.id)) ?? pendingSessionTitle(entry.id),
      // The id's own clock, never `Date.now()`: the row is ranked by
      // `updated_at`, and a re-stamp on every revalidate kept it perpetually
      // newest and reshuffled LATEST_SESSION ordering mid-run.
      created_at: stamp,
      updated_at: stamp,
      // The row's own reason for existing past the click: its prompt is held.
      ...(entry.waiting
        ? { waitingFor: { waitId: entry.waiting.waitId, sessionId: entry.waiting.dependsOn, title: entry.waiting.dependsOnTitle } }
        : {}),
    };
    result = result.map((folder) => (
      folder.id === target.id
        ? { ...folder, isExpanded: true, sessions: [row, ...(folder.sessions ?? [])] }
        : folder
    ));
  }
  return result;
}

/**
 * The folder ids the given pending entries' rows land in.
 *
 * The same resolution `withPendingRows` uses — one function, so the auto-expand
 * rule in the sidebar controller cannot point at a different folder than the
 * one the row is actually drawn in.
 */
export function pendingHostFolderIds(
  folders: WorkspaceFolderData[],
  entries: PendingSessionEntry[],
  options: PendingRowOptions,
): string[] {
  if (entries.length === 0 || folders.length === 0) return [];
  const ids = new Set<string>();
  for (const entry of entries) {
    const target = resolvePendingFolder(folders, entry, options);
    if (target) ids.add(String(target.id));
  }
  return [...ids];
}

/**
 * Which folder a pending row belongs to: the one it was started in, else the
 * one owning the session on screen, else the URL's pick, else the first folder.
 * An entry whose folder no longer exists falls through the same chain rather
 * than dropping the row.
 */
function resolvePendingFolder(
  folders: WorkspaceFolderData[],
  entry: PendingSessionEntry,
  options: PendingRowOptions,
): WorkspaceFolderData | undefined {
  if (entry.folderId !== null && entry.folderId !== undefined) {
    const byEntry = folders.find((folder) => String(folder.id) === String(entry.folderId));
    if (byEntry) return byEntry;
  }
  if (options.activeId) {
    const byActive = folders.find((folder) => (
      (folder.sessions ?? []).some((session) => String(session.id) === String(options.activeId))
    ));
    if (byActive) return byActive;
  }
  if (options.urlFolderId) {
    const byUrl = folders.find((folder) => String(folder.id) === String(options.urlFolderId));
    if (byUrl) return byUrl;
  }
  return folders[0];
}
