/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A workspace opens when a row inside it needs to be seen.
 *
 * Two rows are drawn without the folder being open: a session whose run is in
 * flight (the spinner is the answer to "did my prompt land?"), and a chat omp
 * has not written a transcript for yet (the row exists only because Kabmo drew
 * it). A collapsed workspace hid exactly those two, so both are answered here.
 *
 * The flag is the SERVER's (`workspace_folders.is_expanded`, written through the
 * same toggle the category header uses), so a reload and the other layout read
 * one answer. The write is EDGE-triggered per session id: a folder this mount
 * already opened is never written open again, so the structure push that every
 * tool call causes does not re-issue it. A run whose session the structure does
 * not carry yet stays "fresh" until the push that names its folder arrives.
 *
 * The hook also returns the folder ids holding a live run, which the caller
 * forces open in the rendered list: the row has to be visible on the frame the
 * spinner appears, not one round trip later. Same rule `withPendingRows`
 * applies to a pending row's host folder.
 */

import { useEffect, useMemo, useRef } from 'preact/hooks';
import type { PendingSessionEntry } from '@/client/hooks/chat/omp/pending-sessions';
import { pendingHostFolderIds } from '@/client/hooks/chat/omp/pending-rows';
import { setFolderExpanded } from '@/client/hooks/workspace/folder-expansion';
import type { WorkspaceFolderData } from '@/shared/types';

export interface FolderAutoExpandInput {
  folders: WorkspaceFolderData[];
  /** True before the first sidebar snapshot lands. */
  initializing: boolean;
  /** Ids whose run is in flight — the sidebar's `stream` rows. */
  runningIds: Set<string>;
  pendingEntries: PendingSessionEntry[];
  /** The session the URL has open; its folder is a pending row's fallback host. */
  activeId: string | null;
  /** `?folderId=`, the last resort before the first folder. */
  urlFolderId: string | null;
}

/** The folder whose rows carry `sessionId`, if the structure has scanned it. */
export function folderHosting(
  folders: WorkspaceFolderData[],
  sessionId: string,
): WorkspaceFolderData | undefined {
  return folders.find((folder) => (
    (folder.sessions ?? []).some((session) => String(session.id) === sessionId)
  ));
}

export function useFolderAutoExpand(input: FolderAutoExpandInput): Set<string> {
  const { folders, initializing, runningIds, pendingEntries, activeId, urlFolderId } = input;

  const runningFolderIds = useMemo(() => {
    const ids = new Set<string>();
    for (const id of runningIds) {
      const host = folderHosting(folders, id);
      if (host) ids.add(String(host.id));
    }
    return ids;
  }, [folders, runningIds]);

  const seenRef = useRef({ running: new Set<string>(), pending: new Set<string>() });
  useEffect(() => {
    if (initializing || folders.length === 0) return;
    const seen = seenRef.current;
    const nextRunning = new Set<string>();
    const nextPending = new Set<string>();
    const targets = new Set<string>();

    for (const id of runningIds) {
      if (seen.running.has(id)) {
        nextRunning.add(id);
        continue;
      }
      const host = folderHosting(folders, id);
      // Not scanned yet: left "fresh" so the push that carries its row — and
      // therefore its folder — still opens the workspace.
      if (!host) continue;
      nextRunning.add(id);
      targets.add(String(host.id));
    }

    const pendingOptions = { activeId, urlFolderId };
    for (const entry of pendingEntries) {
      const id = String(entry.id);
      if (seen.pending.has(id)) {
        nextPending.add(id);
        continue;
      }
      nextPending.add(id);
      for (const folderId of pendingHostFolderIds(folders, [entry], pendingOptions)) {
        targets.add(folderId);
      }
    }

    seen.running = nextRunning;
    seen.pending = nextPending;

    for (const id of targets) {
      const folder = folders.find((item) => String(item.id) === id);
      if (!folder || folder.isExpanded) continue;
      void setFolderExpanded(id, true);
    }
  }, [initializing, folders, runningIds, pendingEntries, activeId, urlFolderId]);

  return runningFolderIds;
}
