/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Report a steer's outcome, because a steer that did not go out has to SAY so.
 *
 * Both steer paths clear the composer BEFORE they await
 * (`handleSend` on Ctrl/Cmd+Enter, `handleSendNowQueueItem` for a queued row),
 * and the draft is restored on failure — so without this the only evidence was
 * the text reappearing, which reads as "nothing happened yet" rather than
 * "the steer was refused". The server names the reason (a pending approval
 * dialog, an idle session), so it is surfaced verbatim.
 *
 * Three call sites share it so the wording cannot drift between them: the
 * explicit-steering branch, the `followUpBehavior: 'steering'` branch, and the
 * queue's Send Now.
 */

import type { PromptDispatchResult } from '@/shared/types';

export function reportSteerOutcome(
  result: PromptDispatchResult,
  report: (message: string) => void,
): void {
  if (result.ok) return;
  // An unacknowledged steer is not a failure — omp queues it before it parks,
  // so it may well be running. Worded as a warning so the user does not resend.
  if (result.uncertain) {
    report(`Steer ${result.error ?? 'was not acknowledged'}`);
    return;
  }
  report(`Steer failed: ${result.error ?? 'the session refused it'}`);
}
