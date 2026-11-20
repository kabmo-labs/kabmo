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
import { transcriptFailure } from '@/server/lib/harness/acp/turn-outcome.server';
import type { HarnessId } from '@/shared/lib/harness/catalog';
import type { AcpTurns, AcpTurnEndInfo } from '@/server/lib/harness/acp/turn';
import { driveAcpGoalAfterTurn } from '@/server/lib/harness/acp/acp-goal-driver.server';
import type { AcpGoalHost } from '@/server/lib/harness/acp/acp-goal.server';
import { assistantTextOf, spawnsBackgroundWork, toolIdsOf } from '@/server/lib/harness/acp/background-work';
import { isLostSession } from '@/server/lib/harness/acp/session-lost';

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
  markStream: (status: 'stream' | 'finish' | 'abort', failure?: string | null) => void;
  isAlive(): boolean;
  isBusy(): boolean;
  send(command: Record<string, unknown>): Promise<unknown>;
  /** Drop this session when the agent says it no longer has it, so the next
   *  command respawns and resumes. */
  dropLostSession?: () => void;
}

/** What the turn-end bookkeeping moves on the session. */
export interface AcpTurnEndHost
  extends Omit<AcpTurnTarget, 'runModel' | 'sessionId' | 'isAlive' | 'isBusy' | 'send'>, AcpGoalHost {
  assistantCount: number;
  usage: { endTurn(): void };
  background: { start(baseline: string, knownTools?: readonly string[]): void };
}

/**
 * Everything a turn's END moves: the closed message, the durable marker, the
 * queue, the child outcome, the background probe and the goal driver.
 *
 * A turn closed by the SILENCE CEILING is interrupted, not failed — nothing
 * observed it fail — and its reason still travels so a coordinator can act.
 */
export function endAcpTurn(host: AcpTurnEndHost, info: AcpTurnEndInfo): Promise<void> {
  if (info.closedMessage) host.assistantCount += 1;
  host.usage.endTurn();
  const reported = settleAcpTurn(host, info);
  // A subagent outlives the turn that spawned it: antigravity answers
  // `end_turn` right after `invoke_subagent`, and its completion is held until
  // the next request (upstream #1461). Probe the transcript instead.
  if (!info.cancelled && info.failed !== true && spawnsBackgroundWork(info.message)) {
    // The replay repeats this turn's own calls; only work that is NEW is news.
    host.background.start(assistantTextOf(info.message), toolIdsOf(info.message));
  }
  void driveAcpGoalAfterTurn(host, info.message, { cancelled: info.cancelled === true }).catch(() => {});
  return reported;
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
export async function settleAcpTurn(
  target: AcpTurnTarget & { harness: HarnessId },
  info: AcpTurnEndInfo,
): Promise<void> {
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
  // A turn the envelope calls COMPLETED may still have failed: `omp-acp` answers
  // a provider error as ordinary text and ends the turn normally, so its own
  // transcript is the only record of the failure (see `turn-outcome.server.ts`).
  const recorded = info.failed === true || info.cancelled === true || info.stranded === true
    ? null
    : await transcriptFailure(target.harness, target.sessionId);
  // A turn closed by the silence ceiling is INTERRUPTED, not failed: nothing
  // observed it fail, and the reason still travels so the coordinator can act.
  const status = info.cancelled === true || info.stranded === true
    ? 'interrupted'
    : info.failed === true || recorded !== null
      ? 'failed'
      : 'completed';
  // A cancelled turn is an `abort` badge; every other ending a `finish` — and a
  // failed turn carries the agent's own reason, which is the only copy a tab
  // that never opened the session can read.
  const failure = status === 'failed'
    ? (info.failure?.trim() || recorded || 'The agent ended the turn without an answer')
    : null;
  target.markStream(info.stopReason === 'cancelled' ? 'abort' : 'finish', failure);
  // Todo/plan/telemetry panels read their own topics; without this signal an
  // ACP turn's usage and titles never republished (the RPC settle path does it).
  emitRealtimeSignal('session-data-dirty', target.sessionId);
  const finalText = lastAssistantText([info.message]);
  // Only a real answer is stored as one: on a failed turn the text IS the
  // error, and `session_answers` is what `kabmo session output` prints.
  if (finalText && status === 'completed') {
    void saveSessionAnswer(target.sessionId, finalText).catch(() => {});
  }
  // A lost agent session is not recoverable in THIS process: every later prompt
  // answers the same refusal. Dropping the session lets the route respawn it and
  // resume from the agent's own history — the alternative is a chat that can
  // never send again.
  if (isLostSession(info.failure) && target.dropLostSession) {
    target.dropLostSession();
  }
  const reported = noteChildOutcome({
    sessionId: target.sessionId,
    status,
    // A failed turn's text is the error, not a report: the reason is the detail.
    output: status === 'completed' ? finalText : null,
    ...(status === 'failed'
      ? { failure: failure as string }
      : status === 'interrupted' && info.stranded === true
        ? { failure: info.failure ?? 'The agent stopped reporting progress.' }
        : {}),
  }).catch((error: unknown) => {
    console.error('[sessions] could not record an ACP child outcome:', error);
  });
  scheduleQueueDelivery(target);
  return reported;
}
