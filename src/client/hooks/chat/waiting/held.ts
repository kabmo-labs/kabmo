/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The held prompt of the chat on screen, and how to drop it.
 *
 * A chat whose prompt is deferred has no session and no transcript, so the
 * composer is the only place the wait is visible — and it must be DISABLED
 * while the wait lasts: a second prompt would have nowhere to go.
 */

import { useCallback, useMemo } from 'preact/hooks';
import { useWaitingPrompts } from '@/client/hooks/chat/waiting/store';
import { useCancelWait } from '@/client/hooks/chat/waiting/cancel';
import type { WaitingPrompt } from '@/shared/types/waiting';

export interface HeldWait {
  /** The waiting row for the open chat, or null. */
  heldWait: WaitingPrompt | null;
  cancelHeldWait: () => void;
}

export function useHeldWait(
  sessionId: string | null,
  isPendingSession: boolean,
  onNotice?: (message: string, type?: 'success' | 'error') => void,
): HeldWait {
  const { prompts } = useWaitingPrompts();
  const cancelWait = useCancelWait(onNotice);
  const heldWait = useMemo(
    () => (isPendingSession
      ? prompts.find((prompt) => prompt.pendingId === sessionId && prompt.status === 'waiting') ?? null
      : null),
    [isPendingSession, sessionId, prompts],
  );
  const cancelHeldWait = useCallback(() => {
    if (heldWait) cancelWait(heldWait.id);
  }, [heldWait, cancelWait]);
  return { heldWait, cancelHeldWait };
}
