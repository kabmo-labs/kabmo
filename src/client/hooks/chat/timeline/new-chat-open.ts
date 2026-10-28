/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The New Chat card's open state, and the prewarm its click fires.
 *
 * Both live here because they are one decision: the moment the card opens is
 * the earliest point at which the chat's cwd is known, and the first send is
 * what pays for the omp spawn (measured 675-934 ms). The card routinely sits
 * open while the instruction is written, so warming the child then hides that
 * boot entirely.
 *
 * The folder resolution mirrors `useNewChatSubmit` — the active session's
 * folder, else the composer's pick — because a prewarm in a different cwd is a
 * process the send never claims, which costs a spawn AND a kill.
 */

import { useCallback, useState } from 'preact/hooks';
import type { Attachment, WorkspaceFolderData } from '@/shared/types';
import { activeProjectForSession } from '@/shared/lib/workspace/active-project';
import { spawnCwdForNewSession, triggerSessionPrewarm } from '@/shared/lib/omp/session/prewarm';

export interface NewChatOpen {
  /** The seeded content, or null while the card is closed. */
  content: string | null;
  /** Attachments of the row the card was opened from. */
  attachments: Attachment[];
  /** Open the card on `content`, warming the child for the chat it will create. */
  open: (content: string, attachments?: Attachment[]) => void;
  close: () => void;
}

export interface NewChatOpenDeps {
  folders: WorkspaceFolderData[];
  /** Session the card was opened from — the scope the prewarm inherits. */
  sessionId: string | null;
  selectedFolderId: number | null;
}

export function useNewChatOpen({ folders, sessionId, selectedFolderId }: NewChatOpenDeps): NewChatOpen {
  const [content, setContent] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const open = useCallback((next: string, rows?: Attachment[]) => {
    const folderId = activeProjectForSession(folders, sessionId).folder?.id ?? selectedFolderId ?? undefined;
    const cwd = spawnCwdForNewSession(folders, sessionId, folderId);
    if (cwd) triggerSessionPrewarm(cwd);
    setContent(next);
    setAttachments(rows ?? []);
  }, [folders, sessionId, selectedFolderId]);

  const close = useCallback(() => {
    setContent(null);
    setAttachments([]);
  }, []);

  return { content, attachments, open, close };
}
