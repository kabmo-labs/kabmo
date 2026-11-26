/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Command dispatch for a live omp session. Extracted from AgentSessionWrapper
 * (rpc-manager.ts) so that file stays under the repo's per-file size ceiling.
 * The host object exposes the wrapper's runtime state; behavior is unchanged.
 */

import { RpcCommandError, RpcCommandTimeoutError } from '@kabmo-labs/kabmo-omp-rpc-process/process';
import { AGENT_BUSY_MESSAGE, AGENT_BUSY_REFUSAL_RE, AWAITING_AGENT_START_TIMEOUT_MS, GET_STATE_TIMEOUT_MS, IMAGE_BEARING_COMMANDS, PASSTHROUGH_COMMANDS, RESTARTING_MESSAGE, STEER_ACK_TIMEOUT_MS, WebRpcError, promptAckTimeoutMs, toImageContents, type RpcSessionState, validateAgentImages } from '@kabmo-labs/kabmo-omp-rpc-protocol/constants';
import { clearSessionFileCaches } from '@kabmo-labs/kabmo-omp-session-scan/files';
import { awaitTitleDispatch } from '@kabmo-labs/kabmo-omp-session-runtime/title-request.server';
import { nudgeQueueDelivery } from './queue-nudge';
import { clearStreamStatus, markStreamStatus } from '@kabmo-labs/kabmo-session-stream-state';
import { buildWebState } from '@kabmo-labs/kabmo-omp-rpc-process/web-state';
import {
  refuseTuiOnlyPrompt,
  refuseWhenBlockedOnDialog,
  settleCommandTimeout,
  type SessionCommandHost,
} from './session-command-guards';

export type { SessionCommandHost } from './session-command-guards';

export async function dispatchSessionCommand(host: SessionCommandHost, command: Record<string, unknown>): Promise<unknown> {
  if (host.restarting) throw new WebRpcError(RESTARTING_MESSAGE, 'session_restarting');
  if (!host.isAlive()) throw new Error('Session is no longer running');
  host.idle.reset();
  const type = command.type as string;

  if (IMAGE_BEARING_COMMANDS.has(type)) {
    const imageError = validateAgentImages(command.images);
    if (imageError) throw new Error(imageError);
  }

  switch (type) {
    case 'prompt': {
      if (host.bashRunning) {
        throw new Error('Cannot send a prompt while a shell command is running');
      }
      // Checked before the streaming-behavior split: a steer of a TUI-only
      // command is just as meaningless as a fresh one. `streaming` keeps the
      // refusal from clearing a running turn's flags when the prompt was a
      // steer aimed at that turn.
      if (refuseTuiOnlyPrompt(host, command.message, Boolean(command.streamingBehavior))) return null;
      // A rename the finished run asked for must be ON THE WIRE before this
      // prompt is: both are separate frames on one stdin, and a prompt admitted
      // first lets the rename name a conversation that has already moved on.
      // The wait is the dispatch ack (~3 ms), never the generation, and it is
      // bounded so a wedged child cannot hold the operator's prompt.
      await awaitTitleDispatch(host);
      const streamingBehavior = command.streamingBehavior as 'steer' | 'followUp' | undefined;
      // A slash command is Kabmo's control channel or one of omp's builtins, and
      // NEITHER opens a turn on its own. Measured against omp 18.22.2:
      //   - a LOCAL builtin (`/rename`, `/usage`) acks `{agentInvoked:false}` and
      //     sends no `prompt_result`;
      //   - an EXTENSION command (`/kabmo-mode plan republish`) acks BARE
      //     (`{"type":"response","command":"prompt","success":true}`) and reports
      //     `prompt_result {agentInvoked:false}` afterwards.
      // So a slash command must not claim the turn slot optimistically. The
      // claim wrote a `stream` row and held `promptRunning` for the agent-start
      // watchdog, while the frame that proved no turn opened was suppressed by
      // the run-attribution rule — the sidebar spinner and the docked indicator
      // kept turning for 10 s over a session that had already finished
      // (reproduced on mount: the plan-review `republish`). A slash command that
      // DOES open a turn is covered by the frames: its `agent_start` sets both
      // flags and writes the row itself, milliseconds later.
      const looksLikeCommand = typeof command.message === 'string' && command.message.trimStart().startsWith('/');
      // The live `stream` row starts with the DISPATCH, not with agent_start:
      // the spawn/ack round trip that precedes agent_start must not read as
      // "nothing happened" in the sidebar after the user hit send. Skipped
      // while a turn already streams — that row belongs to the running turn,
      // and this dispatch's failure must never roll it back.
      //
      // `isRunning()`, NOT `streaming`: `streaming` only flips at `agent_start`,
      // so a dispatch that arrives DURING the ack round trip of an earlier one
      // saw `streaming === false` and claimed the turn slot for itself. The
      // own `/kabmo-mode` commands are dispatched on that path (the
      // plan-review `republish`, a mode toggle), so the claim made them release
      // the RUNNING turn's `stream` row and emit a `prompt_result` — which the
      // client folds as "the run settled", blanking the generating indicator
      // mid-answer. `isRunning()` is true for the whole dispatch (promptRunning
      // is set before the ack), so a secondary command now owns nothing and
      // settles nothing.
      const ownsSlot = !streamingBehavior && !host.isRunning() && Boolean(host.sessionId);
      const ownsStreamRow = ownsSlot && !looksLikeCommand;
      // A prompt that never started a turn leaves no run behind, so the row we
      // wrote must go — unless a turn began meanwhile, which owns it now.
      const releaseStreamRow = (): void => {
        if (ownsStreamRow && !host.streaming) void clearStreamStatus(host.sessionId);
      };
      if (!streamingBehavior && !looksLikeCommand) {
        host.promptRunning = true;
        host.promptDispatchPendingCount += 1;
        host.awaitingAgentStart = false;
        host.awaitingAgentStartDeadline = 0;
        host.continuationGraceUntil = 0;
        // The row carries the model this run is served by: known here because
        // the warmup `get_state` (and any `set_model`) reconciled it. A later
        // `agent_start` re-marks the same row without a model, and the upsert's
        // COALESCE keeps this pair.
        if (ownsStreamRow) void markStreamStatus(host.sessionId, 'stream', host.runModel);
      }
      try {
        // Resolved once: the same payload decides both what rides the command
        // and how long its ack may take.
        const images = toImageContents(command.images);
        const ack = await host.proc.sendCommand<{ agentInvoked?: boolean } | undefined>({
          type: 'prompt',
          message: command.message as string,
          ...(images ? { images } : {}),
          ...(streamingBehavior ? { streamingBehavior } : {}),
        }, promptAckTimeoutMs(command.images));
        if (ack?.agentInvoked === false && !streamingBehavior) {
          // omp's own word that this prompt opened no turn. Settle the dispatch
          // and tell the client, which is what releases its optimistic turn.
          // Gated on the slot being FREE when the prompt arrived: a local
          // builtin dispatched mid-turn (a `/usage` typed while a run streams)
          // must not settle the run the operator is watching. A slash command
          // never claimed the slot, so this branch is its only settle path for
          // the `{agentInvoked:false}` ack — the row was never written, and the
          // client still needs the frame.
          if (ownsSlot) {
            host.promptRunning = false;
            host.awaitingAgentStart = false;
            host.awaitingAgentStartDeadline = 0;
            releaseStreamRow();
            host.emit({ type: 'prompt_result', agentInvoked: false });
            // Nothing ran (agent was idle and declined) — the queue may hold the
            // next item; give it the same delivery window a run end would.
            nudgeQueueDelivery(host);
          }
        } else if (!streamingBehavior && ack?.agentInvoked !== false && ownsStreamRow) {
          host.awaitingAgentStart = true;
          host.awaitingAgentStartDeadline = Date.now() + AWAITING_AGENT_START_TIMEOUT_MS;
          // Nothing else watches this deadline. Without the watchdog a dispatch
          // whose turn never opens (omp accepted the prompt and emitted no
          // `agent_start` — measured with Kabmo's own `/kabmo-mode`,
          // whose bare `{success:true}` ack reads as a run) leaves
          // `promptRunning` true forever AND the `stream` row owned by a LIVE
          // process, which the sidebar heal cannot reach. See the method.
          host.armAgentStartWatchdog?.();
        }
      } catch (error) {
        host.promptRunning = false;
        host.awaitingAgentStart = false;
        host.awaitingAgentStartDeadline = 0;
        releaseStreamRow();
        // The ack may simply be queued behind a running turn: omp accepts the
        // prompt before the turn it starts. No reset, and the client must not
        // resend — a duplicate prompt would run twice.
        if (error instanceof RpcCommandTimeoutError) await settleCommandTimeout(host);
        // omp's typed refusal for a PLAIN prompt dispatched mid-turn
        // (`AgentBusyError`). Nothing was delivered, so this is not a command
        // failure: the caller queues the message and re-sends it when the run
        // ends. Reporting it as `session_busy` is what lets a client that did
        // not know a run was in flight (a second tab, a reload, another
        // instance) recover instead of losing the prompt.
        if (error instanceof RpcCommandError && AGENT_BUSY_REFUSAL_RE.test(error.message)) {
          // omp's verdict outranks our flags: a turn IS in flight, whatever
          // this wrapper believed. The queue's delivery gate reads `isBusy()`,
          // so without this a stale-idle wrapper (a `get_state` probe whose
          // answer landed after `agent_start` clears both flags) dispatched at
          // the child every retry and collected `agent_busy` for the rest of
          // the run — measured as 104 failures in one session, each one
          // requeueing the head. `agent_end`, or the settle probe's `isSettled`,
          // is what clears it again.
          host.streaming = true;
          // ...and the run-settle clock retires it if that frame never comes.
          host.runSettle?.arm();
          throw new WebRpcError(AGENT_BUSY_MESSAGE, 'agent_busy');
        }
        throw error;
      } finally {
        // Only a dispatch that INCREMENTED the count may decrement it: a slash
        // command never claims the slot, and its `finally` would otherwise
        // consume a concurrent plain prompt's pending count.
        if (!streamingBehavior && !looksLikeCommand) {
          host.promptDispatchPendingCount = Math.max(0, host.promptDispatchPendingCount - 1);
        }
      }
      return null;
    }

    case 'abort':
      // Refused rather than waited on: a pending dialog parks omp's command
      // loop, so this ack would never arrive (see the guard). Stop's own
      // escalation (`force_reset`) is the escape hatch and is NOT guarded —
      // destroying the child must stay reachable from a blocked session.
      refuseWhenBlockedOnDialog(host);
      await host.proc.sendCommand({ type: 'abort' });
      host.promptRunning = false;
      host.awaitingAgentStart = false;
      host.awaitingAgentStartDeadline = 0;
      host.continuationGraceUntil = 0;
      if (host.sessionId) void markStreamStatus(host.sessionId, 'abort');
      return null;

    // Escape hatch behind the Stop button: `abort` resolves only once the turn
    // actually stops, so a session wedged on a subagent never answers it. The
    // caller (shared/lib/chat/omp/abort.ts) escalates to this after a grace
    // period and accepts losing the in-flight work.
    case 'force_reset':
      await host.destroyAndWait();
      return null;

    case 'get_state': {
      try {
        const state = await host.proc.sendCommand<RpcSessionState>({ type: 'get_state' }, GET_STATE_TIMEOUT_MS);
        return buildWebState(host, state);
      } catch (error) {
        if (error instanceof RpcCommandTimeoutError) await settleCommandTimeout(host);
        throw error;
      }
    }

    case 'set_model': {
      const { provider, modelId } = command as { provider: string; modelId: string };
      const model = await host.proc.sendCommand<{ id: string; provider: string }>({ type: 'set_model', provider, modelId });
      // The ack names the model omp RESOLVED (an alias or fallback may differ
      // from the request), which is what the indicator must report.
      host.runModel = { provider: model.provider, modelId: model.id };
      return { id: model.id, provider: model.provider };
    }

    case 'set_fast_mode': {
      const enabled = command.enabled === true;
      const result = await host.proc.sendCommand<{ enabled?: boolean; active?: boolean }>({ type: 'set_fast_mode', enabled });
      host.fastModeEnabled = result?.enabled ?? enabled;
      return { enabled: host.fastModeEnabled, active: result?.active ?? false };
    }

    case 'compact': {
      try {
        host.compacting = true;
        try {
          const result = await host.proc.sendCommand<{ summary?: string; tokensBefore?: number; estimatedTokensAfter?: number }>({
            type: 'compact',
            ...(command.customInstructions ? { customInstructions: command.customInstructions } : {}),
          });
          return result;
        } finally {
          host.compacting = false;
        }
      } finally {
        clearSessionFileCaches();
      }
    }

    case 'abort_compaction':
      await host.proc.sendCommand({ type: 'abort' });
      return null;

    case 'set_session_name': {
      const name = (command.name as string | undefined)?.trim();
      if (!name) throw new Error('Session name cannot be empty');
      await host.proc.sendCommand({ type: 'set_session_name', name });
      clearSessionFileCaches();
      return null;
    }

    case 'get_commands': {
      const data = await host.proc.sendCommand<{ commands: unknown[] }>({
        type: 'get_available_commands',
      });
      return data;
    }

    case 'bash': {
      if (host.isRunning()) {
        throw new Error('Cannot run a shell command while the session is busy');
      }
      host.bashRunning = true;
      try {
        return await host.proc.sendCommand<{ output?: string; exitCode?: number }>({ type: 'bash', command: command.command as string });
      } finally {
        host.bashRunning = false;
        clearSessionFileCaches();
      }
    }

    case 'extension_ui_response': {
      // Fire-and-forget: omp answers ask/approval dialogs without a response
      // frame, so a request/response round-trip would time out.
      const { id, ...rest } = command as { id: string; [key: string]: unknown };
      if (!id) throw new Error('extension_ui_response requires an id');
      host.proc.sendFrame({ type: 'extension_ui_response', id, ...rest });
      // Answered — stop offering it to clients that attach later.
      host.resolvePendingUiDialog(id);
      return null;
    }

    case 'steer':
    case 'follow_up': {
      if (!host.isRunning()) {
        throw new WebRpcError('The session is idle — start a prompt first.', 'session_idle');
      }
      if (refuseTuiOnlyPrompt(host, command.message, true)) return null;
      // Bounded, but never reset: omp queues the message before it parks on a
      // pending dialog, so a late ack means "delivered, ack held" — destroying
      // the child would discard the very steer the user is waiting on. The
      // caller gets `rpc_command_timeout` and the message still runs.
      await host.proc.sendCommand({
        type,
        message: command.message as string,
        ...(toImageContents(command.images) ? { images: toImageContents(command.images) } : {}),
      }, STEER_ACK_TIMEOUT_MS);
      return null;
    }

    default: {
      if (PASSTHROUGH_COMMANDS.has(type)) {
        // `abort_and_prompt` is the client's steer (Ctrl+Enter / Send Now) and
        // waits on an ack like `abort` does, so it takes the same two rules: a
        // pending dialog refuses it up front, and a late ack times out instead
        // of hanging the request. `abort_and_prompt` is deliberately NOT reset
        // on timeout — omp aborts the old turn and queues the new prompt before
        // it acks, so the work is already done and destroying the child would
        // only throw it away.
        if (type === 'abort_and_prompt') {
          refuseWhenBlockedOnDialog(host);
          const result = await host.proc.sendCommand(command as { type: string }, STEER_ACK_TIMEOUT_MS);
          return result ?? null;
        }
        const result: unknown = await host.proc.sendCommand(command as { type: string });
        if (type === 'set_thinking_level') clearSessionFileCaches();
        return result ?? null;
      }
      throw new Error(`Unsupported command: ${type}`);
    }
  }
}
