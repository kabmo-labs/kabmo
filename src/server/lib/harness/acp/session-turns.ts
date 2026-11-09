/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One turn of an ACP session: open it, and settle what the panels read at its
 * end. Split out of the session because the rules are about ACP's turn model,
 * not about Kabmo's state.
 *
 * ## The dispatch answers an ACK, never the turn
 *
 * `prompt` over the HTTP route means "accepted" to every client — `sendNewPrompt`
 * adopts the session id and wires its stream on that answer — so returning the
 * TURN here parked a brand-new ACP chat on `new-…` for the answer's whole
 * duration: measured on opencode, the URL stayed `?sessionId=new-…`, the docked
 * indicator read "Loading" and the transcript never appeared, while the turn
 * itself was running fine. omp's own `prompt` returns an ack for the same
 * reason, and the turn's end is reported by the `agent_end` frame instead.
 *
 * ## Why the marker is written AFTER the start
 *
 * `turns.start` throws when a turn is already open, and a marker written for a
 * refused prompt would spin the sidebar over a run that never existed.
 *
 * ## What the panels read at the end
 *
 * The assistant message the mapper closed (omp counts the same quantity from its
 * transcript, and the context panel reads `messageCount`), the durable run
 * marker, and the follow-up queue. The queue is armed from the turn's END exactly
 * as the omp wrapper arms it from its own terminal settle: without it an ACP
 * chat's queued follow-up stayed in `queued_messages` forever, because nothing on
 * this transport scheduled a delivery and the client's nudge route only knew
 * omp's wrapper.
 */

import { scheduleQueueDelivery } from '@/server/lib/queue/delivery.server';
import { emitRealtimeSignal } from '@/server/lib/realtime/signals.server';
import { saveAcpUsage } from '@/server/lib/harness/acp/acp-telemetry.server';
import { lastAssistantText } from '@/server/lib/omp/session/goal-driver.server';
import { noteChildOutcome } from '@/server/lib/sessions/notify.server';
import { saveSessionAnswer } from '@/server/lib/sessions/answers.server';
import type { AcpTurns, AcpTurnEndInfo } from '@/server/lib/harness/acp/turn';

/** What a turn reads and moves on the session. */
export interface AcpTurnTarget {
  sessionId: string;
  /** Messages this session has moved: prompts sent plus closed answers. */
  messageCount: number;
  promptCount: number;
  assistantCount: number;
  contextUsage: { tokens: number; contextWindow: number; percent: number } | null;
  totalCost: number;
  runModel: { provider: string; modelId: string } | null;
  /** The durable run marker; a field on the session so a test can stub it. */
  markStream: (status: 'stream' | 'finish' | 'abort') => void;
  isAlive(): boolean;
  isBusy(): boolean;
  send(command: Record<string, unknown>): Promise<unknown>;
}

/** Open a turn and mark the run live. Returns the ACK, never the turn. */
export function beginAcpTurn(
  target: AcpTurnTarget,
  turns: AcpTurns,
  message: string,
  images: unknown,
): unknown {
  const ack = turns.start(message, images);
  target.messageCount += 1;
  target.markStream('stream');
  return ack;
}

/** Turn-end bookkeeping: the closed message, the badge, then the queue. */
export function settleAcpTurn(target: AcpTurnTarget, info: AcpTurnEndInfo): void {
  if (info.closedMessage) target.messageCount += 1;
  // ACP has no transcript to re-read, so the last usage snapshot is what lets
  // the Context ring answer after a reload or a restart.
  void saveAcpUsage({
    sessionId: target.sessionId,
    messageCount: target.messageCount,
    promptCount: target.promptCount,
    assistantCount: target.assistantCount,
    contextUsage: target.contextUsage,
    totalCost: target.totalCost,
    runModel: target.runModel,
  });
  // A cancelled turn is an `abort` badge, every other ending a `finish`.
  target.markStream(info.stopReason === 'cancelled' ? 'abort' : 'finish');
  // Todo/plan/telemetry panels read their own topics; without this signal an
  // ACP turn's usage and titles never republished (the RPC settle path does it).
  emitRealtimeSignal('session-data-dirty', target.sessionId);
  const finalText = lastAssistantText([info.message]);
  if (finalText) void saveSessionAnswer(target.sessionId, finalText).catch(() => {});
  const status = info.cancelled === true
    ? 'interrupted'
    : info.failed === true
      ? 'failed'
      : 'completed';
  void noteChildOutcome({
    sessionId: target.sessionId,
    status,
    output: finalText,
    ...(status === 'failed' ? { failure: info.failure ?? 'The agent ended the turn without an answer' } : {}),
  }).catch((error: unknown) => {
    console.error('[sessions] could not record an ACP child outcome:', error);
  });
  scheduleQueueDelivery(target);
}
