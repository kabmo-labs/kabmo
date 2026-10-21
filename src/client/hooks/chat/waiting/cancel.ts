/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Dropping a held prompt from the row that shows it.
 *
 * A refusal is REPORTED: the only two refusals are "already sent" (the prompt
 * is running now, so Stop the session instead) and "no longer there", and both
 * leave the row on screen. Swallowing them would leave a row that looks stuck
 * with no way to learn why.
 */

import { useCallback } from 'preact/hooks';
import { cancelWaitingPromptRequest } from '@/client/hooks/chat/waiting/store';
import { releasePendingSessionByWait } from '@/client/hooks/chat/omp/pending-waiting';

export type CancelWait = (waitId: string) => void;

export function useCancelWait(onNotice?: (message: string, type?: 'success' | 'error') => void): CancelWait {
  return useCallback((waitId: string) => {
    void cancelWaitingPromptRequest(waitId).then((result) => {
      if (!result.ok) {
        onNotice?.(result.error ?? 'Could not cancel the waiting prompt.', 'error');
        return;
      }
      // The row existed only for this wait, so it goes with it. The topic
      // republish also removes the cue; doing it here keeps the click instant.
      releasePendingSessionByWait(waitId);
      onNotice?.('Waiting prompt cancelled.', 'success');
    });
  }, [onNotice]);
}
