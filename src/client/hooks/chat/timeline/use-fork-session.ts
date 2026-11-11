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
import { startPendingSession } from '@/client/hooks/chat/omp/pending-sessions';
import { setHarnessPick } from '@/client/hooks/chat/timeline/session-harness';
import { formatNewSessionTitle } from '@/shared/lib/omp/session/default-title';
import { forkAnchorFor, type ForkAnchorRole } from '@/shared/lib/chat/timeline/fork-anchor';
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
      const folderId = source?.folder_id ?? selectedFolderId ?? null;
      const anchorEntryId = forkAnchorFor(source?.harness, messageId, role);
      const pendingId = startPendingSession(folderId, {
        title: formatNewSessionTitle(new Date(), 'Fork'),
        ...(source?.harness ? { harness: source.harness } : {}),
        forkSourceSessionId: String(sessionId),
        ...(anchorEntryId ? { forkAnchorEntryId: anchorEntryId } : {}),
      });
      // The picker's first tab is the source's agent; the fork cannot change
      // provider because that agent owns the history being branched.
      if (source?.harness) setHarnessPick(pendingId, source.harness);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('sessionId', pendingId);
        next.set('forkFrom', String(sessionId));
        if (anchorEntryId) next.set('forkAt', anchorEntryId);
        else next.delete('forkAt');
        next.delete('parentSessionId');
        if (folderId !== null && folderId !== undefined) next.set('folderId', String(folderId));
        return next;
      }, { replace: true });
    },
    [sessionId, folders, selectedFolderId, setSearchParams],
  );
}
