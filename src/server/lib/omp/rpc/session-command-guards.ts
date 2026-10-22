/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The gates a command must pass before it reaches the omp child, split from
 * `session-commands.ts` so that dispatcher stays under the repo's per-file size
 * ceiling.
 *
 * Each gate exists because omp's own answer would be a lie or a hang: a timeout
 * that would throw away a live turn, a blocking dialog that parks the whole
 * command loop, a TUI-only slash command that would reach the model as literal
 * text. The host contract they read lives here with them, because they are its
 * only consumers that are not the dispatcher itself.
 */

import type { RpcProcess } from '@/server/lib/omp/rpc/process';
import { SESSION_BLOCKED_ON_DIALOG_MESSAGE, SESSION_BUSY_MESSAGE, WebRpcError, type AgentEvent } from '@/server/lib/omp/rpc/constants';
import { scheduleQueueDelivery } from '@/server/lib/queue/delivery.server';
import { isTuiOnlySlashCommand, tuiOnlyCommandNotice } from '@/shared/lib/chat/composer/tui-only';
import type { SessionRunModel } from '@/shared/lib/omp/session/stream-state.server';
import type { WebStateHost } from '@/server/lib/omp/rpc/web-state';

/** Runtime surface AgentSessionWrapper exposes to the command dispatcher. */
export interface SessionCommandHost extends WebStateHost {
  restarting: boolean;
  /** Model serving this session's latest run, persisted on the stream row when a
   *  prompt is dispatched so the generating indicator can name it. */
  runModel: SessionRunModel | null;
  proc: RpcProcess;
  isAlive(): boolean;
  /** Anything a reset would destroy: the running turn, a compaction, a shell
   *  command, or live subagents. A timed-out command against a busy session is
   *  queued behind that work, not evidence the child is wedged. */
  isBusy(): boolean;
  /** Real omp session id (empty before the first get_state). */
  sessionId: string;
  emit(event: AgentEvent): void;
  /** One dispatch throat (same surface the wrapper's own send uses). */
  send(command: Record<string, unknown>): Promise<unknown>;
  /** Idle clock for this child (see `idle-reaper.ts`). */
  idle: { reset(force?: boolean): void };
  /** Forget a pending ask/approval dialog once its response is sent. */
  resolvePendingUiDialog(id: string): void;
  /** Dialogs omp is still blocked on. A live one wedges the child's command
   *  loop, so a command that waits on its ack must refuse instead. */
  getPendingUiDialogs(): unknown[];
  /** Arm the deadline watchdog for a dispatch whose turn never opened. Optional
   *  so a test host can omit it; the real wrapper always implements it. */
  armAgentStartWatchdog?(): void;
  /** The background `/rename` dispatch a following prompt must be ordered
   *  behind (see `session/title-request.server.ts`). Absent on a host that
   *  never titles, which is why the barrier treats it as idle. */
  autoTitleDispatch?: Promise<void> | null;
  destroyAndWait(): Promise<void>;
}

/** Decide a command timeout's consequence. omp runs RPC handlers one at a
 *  time, so a late `get_state`/`prompt` ack is usually queued behind the
 *  running turn (or behind a subagent's spawn): resetting that child would
 *  throw away a live turn and every subagent it owns. Only a session that is
 *  demonstrably idle AND unresponsive is reclaimed.
 *
 *  Never throws `session_unresponsive` for a busy session, and never suggests a
 *  retry of a command whose acceptance is unknown. */
export async function settleCommandTimeout(host: SessionCommandHost): Promise<never> {
  if (host.isBusy()) throw new WebRpcError(SESSION_BUSY_MESSAGE, 'session_busy');
  await host.destroyAndWait();
  throw new WebRpcError('The OMP session stopped responding and was reset.', 'session_unresponsive');
}

/**
 * Refuse a command whose ack a pending ask/approval dialog would swallow.
 *
 * omp runs RPC handlers one at a time and a blocking dialog parks the loop:
 * measured against omp 18.7.0, `abort` and `abort_and_prompt` both sat
 * unacknowledged for the full 15-20 s of their caps while a `select` dialog was
 * pending, and the steer ran the instant the dialog was answered. Waiting on
 * that ack means an HTTP request that never returns, so the honest answer is a
 * refusal naming the dialog — which is exactly what the client's dialog modal
 * is showing anyway.
 *
 * `steer`/`follow_up` are NOT refused: omp queues them before parking, so the
 * message is not lost, and the ack arrives once the dialog clears.
 */
export function refuseWhenBlockedOnDialog(host: SessionCommandHost): void {
  if (host.getPendingUiDialogs().length > 0) {
    throw new WebRpcError(SESSION_BLOCKED_ON_DIALOG_MESSAGE, 'session_blocked_on_dialog');
  }
}

/**
 * Refuse a prompt that invokes a command omp implements only in its TUI, and
 * report it the way omp reports a real command result.
 *
 * This is the SERVER half of the guard in
 * `client/hooks/chat/timeline/tui-only-guard.ts`. It exists because one prompt
 * path never passes through the composer: the follow-up queue's auto-delivery
 * calls `session.send({ type: 'prompt' })` directly from
 * `lib/queue/delivery.server.ts`. A `/plan` queued before a run would otherwise
 * be delivered to the model as literal text once the run ends.
 *
 * The refusal is framed as a real command result — a `command_output` notice
 * plus, for a non-streaming prompt, the `agentInvoked:false` ack — so the
 * client's existing fold renders the notice and settles the optimistic spinner
 * with no new protocol.
 *
 * `streaming` is the caller's own knowledge of whether a turn is running: a
 * steer of a refused command must not clear the flags of the turn it was aimed
 * at (omp runs `session.steer()` with no slash handling at all, so a steer of
 * `/plan` is exactly as meaningless as a fresh one).
 *
 * Returns true when the prompt was refused (the caller must not dispatch).
 */
export function refuseTuiOnlyPrompt(host: SessionCommandHost, message: unknown, streaming: boolean): boolean {
  if (typeof message !== 'string' || !isTuiOnlySlashCommand(message)) return false;
  host.emit({ type: 'command_output', text: tuiOnlyCommandNotice(message) });
  if (!streaming) {
    host.promptRunning = false;
    host.awaitingAgentStart = false;
    host.awaitingAgentStartDeadline = 0;
    host.emit({ type: 'prompt_result', agentInvoked: false });
    // Nothing ran, so the queue may hold the next item — give it the same
    // delivery window a real consumed builtin or a run end would.
    scheduleQueueDelivery(host);
  }
  return true;
}
