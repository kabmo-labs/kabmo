/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure readers for the frames a side session emits — kept apart from the
 * runtime so its lifecycle code stays readable, and so these small pieces of
 * omp wire knowledge are testable on their own.
 */

import { isRecord } from '@/shared/lib/util/guards';
import { turnStoppedAbnormally } from '@/shared/lib/omp/session/turn-error';
import type { BtwTurnStatus } from '@/shared/types';

/** A turn stopped by the user is 'cancelled'; a provider error is a failure —
 *  both are abnormal stops, so the shared predicate decides (it also reads the
 *  flat `errorStatus`/`errorMessage` fields, which a bare `stopReason` check
 *  would miss). Anything else that produced a terminal `agent_end` completed. */
export function finalStatus(messages: unknown): BtwTurnStatus {
  if (Array.isArray(messages)) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (isRecord(message) && message.role === 'assistant') {
        if (!turnStoppedAbnormally(message)) return 'complete';
        return message.stopReason === 'aborted' ? 'cancelled' : 'error';
      }
    }
  }
  return 'complete';
}

/** The answer as the provider finally reported it; the streamed text is only a
 *  fallback for a frame that carried no messages. */
export function finalAnswer(messages: unknown, streamed: string): string {
  if (!Array.isArray(messages)) return streamed;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!isRecord(message) || message.role !== 'assistant') continue;
    const content = message.content;
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) continue;
    let text = '';
    for (const part of content) {
      if (isRecord(part) && part.type === 'text' && typeof part.text === 'string') text += part.text;
    }
    if (text) return text;
  }
  return streamed;
}
