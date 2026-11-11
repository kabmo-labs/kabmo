/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Open a FORK as the same pending-chat composer New Session uses.
 *
 * Fork used to create the branch before the operator could say what to do in
 * it. Now it navigates to a `new-…` chat that carries the source and anchor in
 * the pending store, so the normal empty-workspace composer (model, thinking,
 * access, attachments) writes the branch's first turn. The POST happens on
 * SEND, in `pending-dispatch.ts`.
 */

import { useCallback } from 'preact/hooks';
import { useSearchParams } from '@/client/lib/router/search-params';
import { forkAnchorFor, type ForkAnchorRole } from '@/shared/lib/chat/timeline/fork-anchor';
import { openForkSession } from '@/client/hooks/chat/timeline/fork-open';
import type { WorkspaceFolderData } from '@/shared/types';

export function useForkSession(
  sessionId: string | null | undefined,
  folders: WorkspaceFolderData[],
  selectedFolderId: number | null,
): (messageId: string, role: ForkAnchorRole) => void {
  const [, setSearchParams] = useSearchParams();

  return useCallback(
    (messageId: string, role: ForkAnchorRole) => {
      if (!sessionId) return;
      const source = folders
        .flatMap((folder) => folder.sessions ?? [])
        .find((session) => String(session.id) === sessionId);
      openForkSession({
        sourceSessionId: String(sessionId),
        ...(source?.harness ? { harness: source.harness } : {}),
        folderId: source?.folder_id ?? selectedFolderId ?? null,
        anchorEntryId: forkAnchorFor(source?.harness, messageId, role),
        setSearchParams,
      });
    },
    [sessionId, folders, selectedFolderId, setSearchParams],
  );
}
