/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The open chat's harness, and whether the composer may change it.
 *
 * Read from the sidebar row the client already has rather than from a new
 * endpoint: the row carries `harness` for the badge, so a second source would be
 * a second answer to "which agent runs this chat".
 *
 * A chat with no row (a pending `new-…`) reports `undefined`, and the picker then
 * offers every tab — the choice rides the spawn instead of re-targeting a
 * session. `editable` is false as soon as a transcript exists: harness is a
 * SPAWN property, so changing it under a conversation would silently switch the
 * frame source for turns that were produced by another agent.
 */

import { useCallback, useMemo } from 'preact/hooks';
import type { WorkspaceFolderData } from '@/shared/types';

export interface SessionHarness {
  /** The harness that owns the open chat, or undefined before it spawned. */
  harness: string | undefined;
  /** False once the chat has messages: switching needs a new chat. */
  editable: boolean;
  /** Records a pick. On a chat that has not spawned the spawn reads it; there
   *  is no live session to re-target. */
  pick: (next: string) => void;
}

export function useSessionHarness(
  folders: WorkspaceFolderData[],
  sessionId: string | null,
  messageCount: number,
  pendingHarnessRef: { current: string | null },
): SessionHarness {
  const harness = useMemo(() => {
    if (!sessionId) return undefined;
    for (const folder of folders) {
      for (const entry of folder.sessions ?? []) {
        if (entry.id === sessionId) return entry.harness;
      }
    }
    return undefined;
  }, [folders, sessionId]);

  const pick = useCallback((next: string) => {
    pendingHarnessRef.current = next;
  }, [pendingHarnessRef]);

  return { harness, editable: messageCount === 0, pick };
}
