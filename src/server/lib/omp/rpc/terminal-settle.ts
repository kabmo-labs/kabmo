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
 */

import {
  triggerAutoSessionTitle,
  type AutoTitleHost,
} from '@/server/lib/omp/session/auto-title.server';
import { scheduleQueueDelivery, type QueueDeliveryHost } from '@/server/lib/queue/delivery.server';
import { requestWaitingSweep } from '@/server/lib/waiting/sweep-trigger';
import { markStreamStatus, loadStreamStatuses } from '@/shared/lib/omp/session/stream-state.server';
import { driveGoalAfterTurn, lastAssistantText } from '@/server/lib/omp/session/goal-driver.server';
import { noteChildOutcome } from '@/server/lib/sessions/notify.server';
import { emitRealtimeSignal } from '@/server/lib/realtime/signals.server';
import { publishSidebarStructure } from '@/server/lib/realtime/topics.server';

/** The wrapper surface a terminal settle touches. */
export interface TerminalSettleHost extends AutoTitleHost, QueueDeliveryHost {
  /** Abort verdict captured from `message_end` — see `SessionFrameHost.runAborted`. */
  runAborted: boolean;
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
 * Reading only the frame therefore reports a stopped run as finished, and the
 * settle then titles the session, audits the goal and releases the queue for a
 * turn the operator cancelled. 12.7% of the runs in this workstation's own
 * session store (494 of 3901) exceed the 1 MiB frame ceiling, so the trimmed
 * case is routine, not exotic.
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
 * Write the terminal stream badge from the ending turn's own stopReason.
 *
 * The `abort` command already wrote `abort` at dispatch time, but the
 * `agent_end` frame arrives later and previously flattened it to `finish`.
 * Re-check the current row and only upgrade `stream` rows, so a `finish`
 * written here can never clobber a newer run's live `stream`/`abort`.
 */
async function markEndStatus(sessionId: string, host: TerminalSettleHost, messages: unknown): Promise<void> {
  if (!sessionId) return;
  const current = await loadStreamStatuses();
  if (current[sessionId] !== 'stream') return;
  await markStreamStatus(sessionId, endedAborted(host, messages) ? 'abort' : 'finish');
}

/**
 * Run the side effects a terminal run end owns.
 *
 * Callers clear the run's own flags (streaming, promptRunning, the
 * awaiting-start and continuation-grace clocks) — that is the fold's state
 * machine, and this function only performs the work the settle triggers.
 */
export function settleTerminalRun(host: TerminalSettleHost, messages: unknown): void {
  const aborted = endedAborted(host, messages);
  if (host.sessionId) void markEndStatus(host.sessionId, host, messages);
  // Delegation is reported here, not from the route: this frame is the only
  // moment that knows a run genuinely ended, and a synthetic `run-settle`
  // reconcile must report the same outcome as a real `agent_end`.
  if (host.sessionId) {
    void noteChildOutcome({
      sessionId: host.sessionId,
      status: aborted ? 'interrupted' : 'completed',
      output: aborted ? null : lastAssistantText(messages),
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
}
