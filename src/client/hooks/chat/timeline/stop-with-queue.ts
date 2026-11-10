/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Stop a run and offer the delivery of the follow-ups it leaves queued.
 *
 * Stop-all semantics: the queue is NOT discarded, so the one useful next action
 * is "send the head now" — surfaced on the toast rather than on a row the user
 * has to find. Kept out of the timeline component because it is one verb and its
 * dependencies, not the layout.
 */

import { useCallback } from 'preact/hooks';
import type { ToastsHandle } from '@/client/hooks/ui/toasts';

export function useStopWithQueuedPrompts<T>(
  stopGenerating: () => number,
  messageQueue: readonly T[],
  sendNow: (item: T) => void,
  pushToast: ToastsHandle['pushToast'],
): () => void {
  return useCallback(() => {
    const heldCount = stopGenerating();
    if (heldCount === 0) return;
    pushToast(
      `Stopped. ${heldCount} message${heldCount > 1 ? 's' : ''} still queued — nothing was sent.`,
      'success',
      {
        action: {
          label: 'Send now',
          onClick: () => {
            const first = messageQueue[0];
            if (first) sendNow(first);
          },
        },
        duration: 8000,
      },
    );
  }, [stopGenerating, pushToast, messageQueue, sendNow]);
}
