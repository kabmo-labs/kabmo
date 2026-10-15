/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The New Chat dialog's first send.
 *
 * The dialog's send handler captured the render it was opened in, so it could
 * not write the pending id into the URL and dispatch the prompt itself: the
 * captured `executeSend` read that render's session, so the first prompt left
 * against the chat the dialog was opened FROM. For an omp session that meant it
 * landed in the previous chat — no spawn happened, the new chat showed an
 * optimistic bubble with no stream and no sidebar spinner (the optimistic mark
 * was armed for the wrong id), and only the SECOND prompt worked, because by
 * then the composer's own handler read the pending scope.
 *
 * The send is PARKED instead, and fired by the render that actually carries the
 * pending id it asked for. That keeps one source of truth for the scope: the
 * deferred call reads the fresh send path (`isOmpSession: false`, the pending id
 * for persistence, the spawn's cwd from the folder the chat was started in).
 */

import { useCallback, useEffect, useRef } from 'preact/hooks';
import type { Dispatch, SetStateAction } from 'preact/compat';
import type { Attachment, ChatMessageData, PromptDispatchResult, WorkspaceFolderData } from '@/shared/types';
import type { SetSearchParams } from '@/client/lib/router/search-params';
import { activeProjectForSession } from '@/shared/lib/workspace/active-project';
import { startPendingSession } from '@/client/hooks/chat/omp/pending-sessions';

export interface NewChatSubmitDeps {
  /** Session the dialog was opened from — the scope this send must NOT use. */
  sessionId: string | null;
  folders: WorkspaceFolderData[];
  /** Composer's explicit folder pick, the fallback when the current session is
   *  not listed under any folder. */
  selectedFolderId: number | null;
  setSearchParams: SetSearchParams;
  setLocalMessages: Dispatch<SetStateAction<ChatMessageData[]>>;
  executeSend: (text: string, attachments: Attachment[]) => Promise<PromptDispatchResult>;
}

export function useNewChatSubmit(deps: NewChatSubmitDeps): (text: string, attachments: Attachment[]) => void {
  const { sessionId, folders, selectedFolderId, setSearchParams, setLocalMessages, executeSend } = deps;
  const parkedRef = useRef<{ pendingId: string; text: string; attachments: Attachment[] } | null>(null);

  useEffect(() => {
    const parked = parkedRef.current;
    // Exact match only: a session switch that is not this pending id (a sidebar
    // click, the back button) must not consume the draft into whatever opened
    // instead — it stays parked and is overwritten by the next New Chat.
    if (!parked || sessionId !== parked.pendingId) return;
    parkedRef.current = null;
    void executeSend(parked.text, parked.attachments);
  }, [sessionId, executeSend]);

  return useCallback((text, attachments) => {
    // The store mints the pending id and owns the row it stands for: the
    // sidebar/navbar show a default title immediately, and the row survives the
    // `new-…` → omp-UUID switch when the first send spawns.
    const pendingId = startPendingSession(activeProjectForSession(folders, sessionId).folder?.id ?? selectedFolderId);
    parkedRef.current = { pendingId, text, attachments };
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('sessionId', pendingId);
      // Carry the workspace the chat was started from: the first send SPAWNS a
      // real omp session in that folder's cwd, and a dialog opened from a
      // session picked in the sidebar has no `folderId` in the URL (the
      // sidebar's own New Session copies it from the current session, which is
      // exactly this). Without one the spawn has no cwd and the send falls back
      // to the simulated stream.
      if (!next.get('folderId')) {
        const folderId = activeProjectForSession(folders, sessionId).folder?.id ?? selectedFolderId;
        if (folderId !== null && folderId !== undefined) next.set('folderId', String(folderId));
      }
      return next;
    }, { replace: true });
    setLocalMessages([]);
  }, [setSearchParams, setLocalMessages, folders, selectedFolderId, sessionId]);
}
