/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What a TERMINAL `agent_end` does, split out of the frame fold.
 *
 * The fold is a switch over every frame type; this is the one branch with a
 * body long enough to be worth its own file, and it is the branch where a
 * missed step is invisible: a run that ends without clearing `streaming`
 * strands the session as "running", and the idle reclaim can never take it back.
 *
 * Three rules live here, and each was learned from a failure:
 *
 * - **An aborted run is not auditable and does not advance anything.** The
 *   operator stopped the turn, so the goal loop is not asked about a half-run
 *   transcript and the queued follow-up is held (stop-all semantics) until the
 *   next run end or an explicit send.
 * - **The title gets one last chance.** The early attempt fires on the first
 *   settled user message and can come back empty (provider error, timeout, a
 *   child that went away, the tiny model declining), and the run end is the
 *   last moment a title can still be derived from the conversation's OPENING
 *   turn. A later run names the session after whatever it had become by then.
 * - **The badge is written from this frame alone.** `turn_end` fires for every
 *   turn of a multi-turn run and carries no `isTerminal`, so it cannot say the
 *   run is over; `agent_end` is the only frame that knows.
 *
 * The CHILD OUTCOME is reported from here too, and it obeys one rule the rest
 * of the settle does not: a run reports ONCE, at the moment it is genuinely
 * over. omp retries a transient provider failure by itself and keeps the run
 * open across the attempts (`agent_end {isTerminal:false}` between them, no
 * terminal end until the saga resolves), so a coordinator that saw an outcome
 * per attempt would be told a worker failed while that worker was still
 * working. `runOutcomeReported` is the latch that makes a second settle — a
 * synthesized one after lost frames, or the process exit — a no-op, and
 * `auto_retry_*` is what names the reason instead of guessing it.
 */

import {
  triggerAutoSessionTitle,
  type AutoTitleHost,
} from '@/server/lib/omp/session/auto-title.server';
import { scheduleQueueDelivery, type QueueDeliveryHost } from '@/server/lib/queue/delivery.server';
import { requestWaitingSweep } from '@/server/lib/waiting/sweep-trigger';
import { markStreamStatus, loadStreamStatuses } from '@kabmo-labs/kabmo-session-stream-state';
import { driveGoalAfterTurn, lastAssistantText } from '@kabmo-labs/kabmo-omp-session-runtime/goal-driver.server';
import { noteChildOutcome } from '@/server/lib/sessions/notify.server';
import { emitRealtimeSignal } from '@kabmo-labs/kabmo-realtime-signals';
import { publishSidebarStructure } from '@/server/lib/realtime/topics.server';
import { AGENT_BUSY_REFUSAL_RE } from '@kabmo-labs/kabmo-omp-rpc-protocol/constants';
import { deriveTurnError, turnStoppedAbnormally } from '@kabmo-labs/kabmo-omp-session-parse/turn-error';
import type { ChildOutcomeNotice } from '@/server/lib/sessions/notify.server';

/** The wrapper surface a terminal settle touches. */
export interface TerminalSettleHost extends AutoTitleHost, QueueDeliveryHost {
  /** Abort verdict captured from `message_end` — see `SessionFrameHost.runAborted`. */
  runAborted: boolean;
  /** The provider failure the run's last settled assistant message carried, in
   *  omp's own words. Captured at `message_end` because the terminal frame is
   *  compacted (see `endedAborted`). */
  runFailure: string | null;
  /** True between `auto_retry_start` and `auto_retry_end`: omp is inside a
   *  retry saga and the run is NOT over. */
  retrySagaOpen: boolean;
  /** The reason the last retry saga closed with, when it closed as a failure. */
  retryFinalError: string | null;
  /** Set once this RUN has told its coordinator how it ended. Cleared at
   *  `agent_start`, so a queued follow-up run reports its own outcome. */
  runOutcomeReported: boolean;
}

/**
 * True when the ending turn was a user abort rather than a natural stop.
 *
 * Two sources, because neither is sufficient alone. `host.runAborted` is read
 * from `message_end`, where the message is still whole; `agent_end.messages` is
 * a fallback for a host that attached mid-run (a reattached client, or a
 * synthetic terminal frame from `run-settle.server.ts`), which never saw one.
 *
 * The frame's own array cannot be the primary source: omp compacts an oversized
 * terminal frame by dropping every message it already delivered through
 * `message_end` (keeping only `messageCount`), and the aborted assistant message
 * is always among them — measured on 18.16.0, `message_end`
 * (`role: "assistant"`, `stopReason: "aborted"`) arrives before `agent_end`.
 * 12.7% of the runs in this workstation's own session store (494 of 3901) exceed
 * the 1 MiB frame ceiling, so the trimmed case is routine, not exotic.
 */
function endedAborted(host: TerminalSettleHost, messages: unknown): boolean {
  if (host.runAborted) return true;
  return (
    Array.isArray(messages) &&
    messages.some((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
      return (entry as Record<string, unknown>).stopReason === 'aborted';
    })
  );
}

/**
 * The failure one assistant message names, or null when it did not fail.
 *
 * omp records the reason as FLAT fields on the message (`stopReason` /
 * `errorStatus` / `errorId` / `errorMessage`) — there is no nested `error`
 * object. Reading one (the shape this replaced) is why a worker whose provider
 * answered "400 The model … is currently unavailable" reported to its
 * coordinator as the bare sentence "The run ended with error": the reason was
 * in the transcript the whole time. `deriveTurnError` is the shared read both
 * render paths already use, so the notice and the timeline cannot disagree.
 */
export function assistantFailure(record: Record<string, unknown>): string | null {
  if (record.role !== 'assistant') return null;
  if (!turnStoppedAbnormally(record)) return null;
  const error = deriveTurnError(record);
  const message = error?.message?.trim();
  if (message) {
    const status = error?.status;
    // Providers usually repeat the status in their own text ("400 The model …"),
    // so prefixing unconditionally printed "400 400 The model …".
    if (status === undefined || message.startsWith(String(status))) return message;
    return `${status} ${message}`;
  }
  const stop = error?.stopReason;
  return stop ? `The turn ended with ${stop}.` : 'The turn ended with an error.';
}

/** The failure a terminal frame reports, or null for a normal stop.
 *
 *  Conservative on purpose: only an assistant message's own error does. A tool
 *  error is not a failed run. */
function endedFailure(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null;
  for (const entry of messages) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const failure = assistantFailure(entry as Record<string, unknown>);
    if (failure) return failure;
  }
  return null;
}

/** The one reason the run did not finish normally, from the most reliable
 *  source that has one. */
function runFailureOf(host: TerminalSettleHost, messages: unknown): string | null {
  return host.retryFinalError
    ?? host.runFailure
    ?? endedFailure(messages)
    // A terminal end while a saga is still open: omp gave up without closing it
    // (or closed it with no reason). Silence would be read as success.
    ?? (host.retrySagaOpen ? 'The run ended while omp was still retrying a provider error.' : null);
}

/**
 * Write the terminal stream badge from the ending turn's own stopReason.
 *
 * The `abort` command already wrote `abort` at dispatch time, but the
 * `agent_end` frame arrives later and previously flattened it to `finish`.
 * Re-check the current row and only upgrade `stream` rows, so a `finish`
 * written here can never clobber a newer run's live `stream`/`abort`.
 */
async function markEndStatus(
  sessionId: string,
  host: TerminalSettleHost,
  messages: unknown,
  failure: string | null,
): Promise<void> {
  if (!sessionId) return;
  const current = await loadStreamStatuses();
  if (current[sessionId] !== 'stream') return;
  if (endedAborted(host, messages)) {
    await markStreamStatus(sessionId, 'abort');
    return;
  }
  await markStreamStatus(sessionId, 'finish', undefined, failure);
}

/**
 * Report a refused `prompt` response as a failed child outcome.
 *
 * A refused prompt opens no turn, so no `agent_end` will ever settle it. The
 * check lives here because this module already owns the outcome vocabulary.
 *
 * A refusal for BUSY is not an outcome: the session is streaming (often
 * mid-retry), nothing was delivered, and Kabmo's queue re-sends. Reporting it
 * told a coordinator its worker had failed while the worker was still running.
 */
export function noteRefusedPrompt(
  event: { type?: string; success?: unknown; command?: unknown; error?: unknown },
  sessionId: string,
): Promise<void> {
  if (event.type !== 'response' || event.success !== false || event.command !== 'prompt' || !sessionId) {
    return Promise.resolve();
  }
  const failure = typeof event.error === 'string' ? event.error : 'Prompt failed';
  if (AGENT_BUSY_REFUSAL_RE.test(failure)) return Promise.resolve();
  return noteChildOutcome({ sessionId, status: 'failed', failure }).catch((error: unknown) => {
    console.error('[sessions] could not record a refused prompt:', error);
  });
}

/**
 * Report a run that ended WITHOUT a terminal frame.
 *
 * Two paths reach this: omp answered `get_state` with `isSettled` after its
 * frame stream stopped (`run-settle.server.ts`), and the omp process exited
 * mid-run. Neither can produce the frame that normally carries the outcome, so
 * without this a coordinator is never told — the worker simply goes quiet, and
 * "no news" is indistinguishable from "still retrying".
 *
 * Never a success: nothing here observed the run finish, and claiming one is
 * the false completion this exists to remove.
 */
export function noteRunEndedWithoutFrame(
  host: { sessionId: string; runOutcomeReported: boolean },
  status: Extract<ChildOutcomeNotice['status'], 'failed' | 'interrupted'>,
  failure: string,
): Promise<void> {
  if (!host.sessionId || host.runOutcomeReported) return Promise.resolve();
  host.runOutcomeReported = true;
  return noteChildOutcome({ sessionId: host.sessionId, status, failure }).catch((error: unknown) => {
    console.error('[sessions] could not record a child outcome:', error);
  });
}

/**
 * Run the side effects a terminal run end owns.
 *
 * Returns the outcome write, so a caller that must observe it (a test, or a
 * shutdown path that wants the row durable) can await it. The frame fold
 * deliberately does not: a settle must never block the frame stream.
 */
export function settleTerminalRun(host: TerminalSettleHost, messages: unknown): Promise<void> {
  const aborted = endedAborted(host, messages);
  const failure = aborted ? null : runFailureOf(host, messages);
  if (host.sessionId) void markEndStatus(host.sessionId, host, messages, failure);
  // Delegation is reported here, not from the route: this frame is the only
  // moment that knows a run genuinely ended, and a synthetic `run-settle`
  // reconcile must report the same outcome as a real `agent_end`. Exactly once
  // per run — see the module header.
  let reported: Promise<void> = Promise.resolve();
  if (host.sessionId && !host.runOutcomeReported) {
    host.runOutcomeReported = true;
    reported = noteChildOutcome({
      sessionId: host.sessionId,
      status: aborted ? 'interrupted' : failure ? 'failed' : 'completed',
      output: aborted ? null : lastAssistantText(messages),
      ...(failure ? { failure } : {}),
    }).catch((error: unknown) => {
      console.error('[sessions] could not record a child outcome:', error);
    });
  }
  if (!aborted) {
    void triggerAutoSessionTitle(host, 'settle');
    void driveGoalAfterTurn({ host, messages });
    scheduleQueueDelivery(host);
  }
  // A prompt held until this session finished is released HERE, and not only by
  // the sweep tick: the run end is the event the wait was about. The delay is
  // the settle grace — the stream row this frame just wrote needs to age past it
  // before the dependency reads as finished, and a queued follow-up armed by the
  // line above needs its window to go out first.
  requestWaitingSweep();
  // A run's work may have touched files and certainly advanced usage; the
  // realtime layer republishes whichever workspace topics are actually watched
  // (see `republishWatchedWorkspaceTopics`).
  emitRealtimeSignal('workspace-dirty');
  // The run's DATA moved too: a `todo` call commits its snapshot to the
  // transcript, and the plan/telemetry/queue topics are read off the same
  // session. Published at the turn boundary rather than per tool for the same
  // reason the workspace topics are: one run emits many, and only the watched
  // topics are re-read.
  if (host.sessionId) emitRealtimeSignal('session-data-dirty', host.sessionId);
  // The final answer appended after the last tool call; the sidebar's ordering
  // and time-ago labels catch up on it the same way.
  publishSidebarStructure();
  return reported;
}
