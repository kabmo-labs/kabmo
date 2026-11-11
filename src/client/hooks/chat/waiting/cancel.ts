/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Dropping a held prompt from the row that shows it.
 *
 * Cancelling returns the prompt to the composer, never to nowhere: the send
 * path cleared the draft when the row was created, so the row is the only copy
 * of what the user wrote. The chat itself is KEPT (the pending entry is not
 * released) — the text it was going to send is back in the box the user is
 * looking at.
 *
 * A refusal is REPORTED: the only two refusals are "already sent" (the prompt
 * is running now, so Stop the session instead) and "no longer there", and both
 * leave the row on screen. Swallowing them would leave a row that looks stuck
 * with no way to learn why.
 */

import { useCallback } from 'preact/hooks';
import { cancelWaitingPromptRequest } from '@/client/hooks/chat/waiting/store';
import { markPendingSessionDraft } from '@/client/hooks/chat/omp/pending-waiting';
import { restoreHeldDraft } from '@/client/hooks/chat/waiting/restore';
import type { ToastTone } from '@/shared/lib/ui/toast-duration';

export type CancelWait = (waitId: string) => void;

export function useCancelWait(onNotice?: (message: string, type?: ToastTone) => void): CancelWait {
  return useCallback((waitId: string) => {
    void cancelWaitingPromptRequest(waitId).then((result) => {
      if (!result.ok || !result.prompt) {
        onNotice?.(result.error ?? 'Could not cancel the waiting prompt.', 'error');
        return;
      }
      restoreHeldDraft(result.prompt);
      // The chat stays as an UNSENT draft carrying the restored text.
      if (result.prompt.pendingId) markPendingSessionDraft(result.prompt.pendingId);
      onNotice?.('Waiting prompt cancelled — your draft is back in the composer.', 'success');
    });
  }, [onNotice]);
}
