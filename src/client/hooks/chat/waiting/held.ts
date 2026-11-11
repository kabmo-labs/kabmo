/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The held prompt of the chat on screen, and how to drop it.
 *
 * A chat whose prompt is deferred has no new transcript, so the composer is the
 * only place the wait is visible — and it must be DISABLED while the wait
 * lasts: a second prompt would have nowhere to go. The wait may belong to a
 * pending `new-…` chat or to an existing session's NEXT prompt, so the lookup
 * names both slots.
 */

import { useCallback, useEffect, useMemo, useRef } from 'preact/hooks';
import { useWaitingPrompts } from '@/client/hooks/chat/waiting/store';
import { useCancelWait } from '@/client/hooks/chat/waiting/cancel';
import type { WaitingPrompt } from '@/shared/types/waiting';
import type { ToastTone } from '@/shared/lib/ui/toast-duration';

export interface HeldWaitOptions {
  onNotice?: (message: string, type?: ToastTone) => void;
  /**
   * A prompt held for THIS existing chat was just delivered elsewhere (the
   * server's sweep). The transcript has no local frames for it, so the view
   * asks the session to reload.
   */
  onDispatched?: (sessionId: string) => void;
}

export interface HeldWait {
  /** The waiting row for the open chat, or null. */
  heldWait: WaitingPrompt | null;
  cancelHeldWait: () => void;
}

export function useHeldWait(sessionId: string | null, options: HeldWaitOptions = {}): HeldWait {
  const { prompts } = useWaitingPrompts();
  const cancelWait = useCancelWait(options.onNotice);
  const { onDispatched } = options;
  const heldWait = useMemo(
    () => (sessionId
      ? prompts.find((prompt) => prompt.status === 'waiting'
        && (prompt.pendingId === sessionId || prompt.targetSessionId === sessionId)) ?? null
      : null),
    [sessionId, prompts],
  );
  const cancelHeldWait = useCallback(() => {
    if (heldWait) cancelWait(heldWait.id);
  }, [heldWait, cancelWait]);

  // The sweep writes `dispatched`; nothing else tells an open chat to re-read
  // its own transcript. One reload per row, not per topic frame.
  const dispatchedRef = useRef(new Set<string>());
  useEffect(() => {
    if (!sessionId || !onDispatched) return;
    for (const prompt of prompts) {
      if (prompt.status !== 'dispatched' || prompt.targetSessionId !== sessionId) continue;
      if (dispatchedRef.current.has(prompt.id)) continue;
      dispatchedRef.current.add(prompt.id);
      onDispatched(sessionId);
    }
  }, [prompts, sessionId, onDispatched]);

  return { heldWait, cancelHeldWait };
}
