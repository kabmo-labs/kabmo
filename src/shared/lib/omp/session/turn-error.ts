/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Single source of truth for deriving a turn's abort/error payload from a raw
 * omp message.
 *
 * omp records an abnormal stop as FLAT fields on the message itself
 * (`stopReason` / `errorStatus` / `errorId` / `errorMessage`) — there is no
 * nested `error` object. Both render paths must read those same fields, or an
 * aborted turn renders one way live and another way after a JSONL reload:
 * - live SSE events:  agent-events.ts → mapper.ts
 * - JSONL reload:     messages-parse.ts → messages-map.ts
 */

import type { ChatMessageData } from '@/shared/types/chat';

/** omp `stopReason` values that mean the turn did not finish normally. */
const ABNORMAL_STOP_REASONS = new Set(['aborted', 'error']);

/** True when the raw omp message ended abnormally (user abort or provider error). */
export function turnStoppedAbnormally(raw: Record<string, unknown>): boolean {
  const stopReason = raw.stopReason;
  if (typeof stopReason === 'string' && ABNORMAL_STOP_REASONS.has(stopReason)) return true;
  return typeof raw.errorStatus === 'number' || typeof raw.errorMessage === 'string';
}

/** Chamber error payload for an abnormally stopped turn — undefined when the
 *  turn finished normally, so callers keep their empty-content guard intact. */
export function deriveTurnError(raw: Record<string, unknown>): ChatMessageData['error'] {
  if (!turnStoppedAbnormally(raw)) return undefined;
  return {
    status: typeof raw.errorStatus === 'number' ? raw.errorStatus : undefined,
    id: typeof raw.errorId === 'number' ? raw.errorId : undefined,
    message: typeof raw.errorMessage === 'string' ? raw.errorMessage : undefined,
    stopReason: typeof raw.stopReason === 'string' ? raw.stopReason : undefined,
  };
}
