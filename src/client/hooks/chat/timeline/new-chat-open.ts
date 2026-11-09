/**
 * @license
 * SPDX-License-Identifier: MIT
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
 * process the send never claims, which costs a spawn AND a kill. The HARNESS is
 * the second half of that rule: the pool holds omp RPC children, so a card
 * opened from an ACP chat (whose new chat stays on that agent) warms nothing.
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
  /**
   * The harness of the chat the card was opened FROM, captured at open time.
   * A New Chat from an ACP answer must stay on that agent: the dialog has no
   * harness picker, and a spawn that omitted it quietly started the new chat on
   * omp's RPC transport instead of the agent that wrote the answer.
   */
  harness?: string;
  /** Open the card on `content`, warming the child for the chat it will create. */
  open: (content: string, attachments?: Attachment[]) => void;
  close: () => void;
}

export interface NewChatOpenDeps {
  folders: WorkspaceFolderData[];
  /** Session the card was opened from — the scope the prewarm inherits. */
  sessionId: string | null;
  selectedFolderId: number | null;
  /** The harness that owns `sessionId`, carried onto the new chat's spawn. */
  harness?: string;
}

export function useNewChatOpen({ folders, sessionId, selectedFolderId, harness }: NewChatOpenDeps): NewChatOpen {
  const [content, setContent] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  /** Captured on open, cleared with the card: the picker is not in the dialog. */
  const [openedHarness, setOpenedHarness] = useState<string | undefined>(undefined);

  const open = useCallback((next: string, rows?: Attachment[]) => {
    const folderId = activeProjectForSession(folders, sessionId).folder?.id ?? selectedFolderId ?? undefined;
    const cwd = spawnCwdForNewSession(folders, sessionId, folderId);
    // The prewarm pool holds `omp --mode rpc-ui` children only. A card opened
    // from an ACP chat now spawns that same agent, so warming omp would start a
    // process the send never claims (then idle-reap it).
    if (cwd && (!harness || harness === 'omp-rpc')) triggerSessionPrewarm(cwd);
    setContent(next);
    setAttachments(rows ?? []);
    setOpenedHarness(harness);
  }, [folders, sessionId, selectedFolderId, harness]);

  const close = useCallback(() => {
    setContent(null);
    setAttachments([]);
    setOpenedHarness(undefined);
  }, []);

  return { content, attachments, ...(openedHarness ? { harness: openedHarness } : {}), open, close };
}
