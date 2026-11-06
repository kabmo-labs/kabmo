/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The open chat's harness, and whether the composer may change it.
 *
 * Three sources, in one order, and the order is the whole contract:
 *
 *  1. the SIDEBAR ROW — what a spawned chat runs on, read from the row the
 *     client already has rather than from a new endpoint, because a second
 *     source would be a second answer to "which agent runs this chat";
 *  2. the SPAWN RECORD (`spawn-harness.ts`) — the row lags a fresh spawn by one
 *     folder read, and this covers that window without inventing a value;
 *  3. the PICK made on a chat that has not spawned yet.
 *
 * The pick used to live only in a ref, and the pending chat's composer was
 * never handed `harness` / `onSelectHarness` at all. So the tab strip moved —
 * `ModelDropdown` keeps its own `viewHarness` — while `pendingHarnessRef` stayed
 * null and the server's `new.ts` fell back to `omp-rpc`: the reported "I sent
 * with the opencode harness but it was processed by omp". A pick therefore has
 * to be BOTH written for the send path (the ref) and rendered (this state).
 *
 * `editable` is false as soon as the chat has a transcript or a sidebar row:
 * harness is a SPAWN property, so changing it under a conversation would
 * silently switch the frame source for turns another agent produced.
 */

import { useCallback, useMemo, useState } from 'preact/hooks';
import type { WorkspaceFolderData } from '@/shared/types';
import { spawnedHarnessFor } from '@/client/hooks/chat/timeline/spawn-harness';

export interface SessionHarness {
  /** The harness that owns the open chat, or undefined before it was picked. */
  harness: string | undefined;
  /** False once the chat has messages or a sidebar row: switching needs a new chat. */
  editable: boolean;
  /** Records a pick. On a chat that has not spawned the spawn reads it; there
   *  is no live session to re-target. */
  pick: (next: string) => void;
  /**
   * The same three facts as the composer's props, so the pending chat's
   * composer and the spawned chat's take ONE slice. They are two branches of
   * `chat-timeline/index.tsx`, and a branch that forgot one of them is exactly
   * how the harness pick stopped reaching the spawn.
   */
  picker: {
    harness?: string;
    harnessEditable: boolean;
    onSelectHarness: (next: string) => void;
  };
}

export function useSessionHarness(
  folders: WorkspaceFolderData[],
  sessionId: string | null,
  messageCount: number,
  pendingHarnessRef: { current: string | null },
): SessionHarness {
  const rowHarness = useMemo(() => {
    if (!sessionId) return undefined;
    for (const folder of folders) {
      for (const entry of folder.sessions ?? []) {
        if (entry.id === sessionId) return entry.harness;
      }
    }
    return undefined;
  }, [folders, sessionId]);

  // The pick belongs to ONE chat: a different pending chat must not inherit the
  // harness chosen for this one. Keyed rather than cleared in an effect, so a
  // render can never observe the previous chat's pick.
  const [picked, setPicked] = useState<{ chatId: string | null; harness: string } | null>(null);
  const pickForThisChat = picked && picked.chatId === sessionId ? picked.harness : undefined;

  const pick = useCallback((next: string) => {
    pendingHarnessRef.current = next;
    setPicked({ chatId: sessionId, harness: next });
  }, [pendingHarnessRef, sessionId]);

  const harness = rowHarness ?? spawnedHarnessFor(sessionId) ?? pickForThisChat;
  const editable = messageCount === 0 && !rowHarness;
  return {
    harness,
    editable,
    pick,
    picker: { ...(harness ? { harness } : {}), harnessEditable: editable, onSelectHarness: pick },
  };
}
