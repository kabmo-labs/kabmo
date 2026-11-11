/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Put a held prompt's text and attachments back into the composer it came from.
 *
 * The row is the ONLY copy while the prompt waits: the send path clears the
 * draft when it creates the wait. A cancel or a failed dispatch therefore has
 * to write that copy back, or the user's text is gone — it was reachable only
 * through a database row with no UI.
 *
 * The write goes through the session-state store rather than a component setter
 * because the cancel may start from the sidebar for a chat that is not mounted.
 * A mounted composer follows the slot (`useComposerDraft` subscribes), and an
 * unmounted one reads it on the next open.
 */

import { CHAT_DRAFT_ATTACHMENTS_KEY, CHAT_DRAFT_KEY } from '@/shared/lib/chat/composer/draft';
import { setSessionKey } from '@/shared/lib/workspace/session-state/store';
import type { WaitingPrompt } from '@/shared/types/waiting';

/** The chat a prompt belongs to: the pending slot, else the session it targets. */
export function waitingDraftSessionId(prompt: WaitingPrompt): string | null {
  return prompt.pendingId ?? prompt.targetSessionId;
}

export function restoreHeldDraft(prompt: WaitingPrompt): void {
  const sessionId = waitingDraftSessionId(prompt);
  if (!sessionId) return;
  setSessionKey(sessionId, CHAT_DRAFT_KEY, prompt.prompt);
  setSessionKey(sessionId, CHAT_DRAFT_ATTACHMENTS_KEY, prompt.attachments);
}
