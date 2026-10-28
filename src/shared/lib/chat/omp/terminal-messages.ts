/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Flushing assistant turns that stopped abnormally and were never streamed as
 * `message_end`.
 *
 * A user abort is the one terminal path where omp emits no `message_end` at all
 * — the synthetic aborted turn rides only in `agent_end.messages`. omp slices
 * out whatever it already streamed, so any message found here is not a
 * duplicate. Without this the failure stays invisible until the session JSONL
 * is reloaded.
 *
 * Split out of `agent-events.ts`, which is at the repo's per-file ceiling; this
 * is the one part of the fold that does not depend on the switch.
 */

import { toChatMessage } from '@/shared/lib/omp/session/mapper';
import { pairToolOutputs } from '@/shared/lib/chat/omp/tool-results';
import type { OmpAgentFoldDeps } from '@/shared/lib/chat/omp/fold-deps';
import type { OmpAgentCallbacks, OmpAgentEvent } from '@/shared/types/omp/agent';

export function materializeTerminalMessages(
  data: OmpAgentEvent,
  deps: OmpAgentFoldDeps,
  callbacks: OmpAgentCallbacks | undefined,
): { errorMessage?: string } {
  if (data.isTerminal === false) return {};
  const messages = data.messages;
  if (!Array.isArray(messages)) return {};
  let errorMessage: string | undefined;
  for (const entry of messages) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const raw = entry as Record<string, unknown>;
    if (raw.role !== 'assistant') continue;
    if (raw.stopReason !== 'aborted' && raw.stopReason !== 'error') continue;
    const converted = toChatMessage(raw, false);
    if (!converted) continue;
    const paired = pairToolOutputs(converted, deps);
    if (paired.toolCalls?.length) deps.lastToolMessageRef.current = paired;
    callbacks?.onMessageEnd?.(paired);
    if (typeof raw.errorMessage === 'string') errorMessage = raw.errorMessage;
  }
  return { errorMessage };
}
