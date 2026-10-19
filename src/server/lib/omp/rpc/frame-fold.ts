/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Folds one omp RPC frame into the session wrapper's runtime state.
 *
 * Mirrors the client's `foldAgentEvent` (shared/lib/chat/omp/agent-events.ts):
 * the same shape of problem — one frame, many state flags — solved the same way
 * so both ends of the transport read alike. Split out of rpc-manager.ts so the
 * wrapper owns only process lifecycle.
 *
 * The state machine is the load-bearing part. `turn_end` fires for EVERY turn
 * in a multi-turn run, `agent_end` is the only frame that knows whether the run
 * is terminal, and a `prompt` response that failed must clear the same flags a
 * successful settle does — a missed clear strands the session as "running" and
 * the idle reclaim can never take it back. What a terminal `agent_end` TRIGGERS
 * lives in `terminal-settle.ts`.
 */

import { clearSessionFileCaches } from '@/server/lib/omp/session/files';
import {
  consumeAutoTitleOutput,
  triggerAutoSessionTitle,
  type AutoTitleHost,
} from '@/server/lib/omp/session/auto-title.server';
import { type QueueDeliveryHost } from '@/server/lib/queue/delivery.server';
import { clearStreamStatus, markStreamStatus } from '@/shared/lib/omp/session/stream-state.server';
import { releasesStreamRowOnPromptResult } from '@/shared/lib/omp/session/stream-heal.server';
import { emitRealtimeSignal } from '@/server/lib/realtime/signals.server';
import { publishSidebarStructure } from '@/server/lib/realtime/topics.server';
import { NON_TERMINAL_CONTINUATION_GRACE_MS, type AgentEvent } from '@/server/lib/omp/rpc/constants';
import { settleTerminalRun } from '@/server/lib/omp/rpc/terminal-settle';
import { parseModeMarker } from '@/shared/lib/omp/mode/markers';
import { SKILL_PROMPT_CUSTOM_TYPE } from '@/shared/lib/omp/session/operator-title';
import type { ModeMirror } from '@/server/lib/omp/rpc/mode-mirror';

/**
 * Wrapper surface the fold reads and writes. Every field is owned by the
 * wrapper; the fold mutates them in place exactly as the inline switch did.
 * Composes the two host contracts the settle path hands the wrapper to
 * (auto-title, queue delivery) so the wrapper itself satisfies this whole type.
 */
export interface SessionFrameHost extends AutoTitleHost, QueueDeliveryHost {
  promptRunning: boolean;
  streaming: boolean;
  compacting: boolean;
  awaitingAgentStart: boolean;
  awaitingAgentStartDeadline: number;
  continuationGraceUntil: number;
  emit(event: AgentEvent): void;
  /** Remember a blocking ask/approval dialog so a reattaching client can answer it. */
  trackUiDialog(frame: AgentEvent): void;
  /** Mirror of omp's plan/goal mode, fed by the frames this fold sees. */
  modeMirror: ModeMirror;
  /** Fold a subagent frame into the liveness roster. */
  observeSubagent(frame: AgentEvent, now: number): void;
  /**
   * Re-read the model the child is actually serving with and rename the live run
   * row to match — omp's payload-less `model_changed`, e.g. a fallback-chain
   * retry that swapped the model mid-run.
   */
  syncRunModel(): void;
}

/** What the caller must do after the fold. */
export interface FrameFoldResult {
  /** The fold already handled this frame's user-visible effect and the caller
   *  must NOT forward it: a failed `prompt` response has emitted its own
   *  `prompt_error`, and a `command_output` belonging to Kabmo's own
   *  background rename must stay out of the timeline. */
  suppressForward: boolean;
}

/**
 * The `message_end` branch: the one place a title can be derived from the
 * conversation's OPENING turn.
 *
 * `agent_start` is too early, and that is not an implementation detail but a
 * property of omp's event order: the agent loop pushes `agent_start` BEFORE the
 * turn opens, and the user's message rides `emitInputMessages` inside that turn.
 * Measured on omp 18.3.0: the user message lands ~120ms after `agent_start`, so
 * a `/rename` fired there reads `messageCount: 0`, builds an empty title
 * context, and omp answers "Could not generate a session title".
 * `message_start` is equally too early — the message is appended to the agent's
 * state on `message_end`, so only here does `get_state` report it.
 *
 * A `/skill:<name>` turn does NOT arrive as `role: "user"`. Measured against a
 * real child, it is `role: "custom"` with `customType: "skill-prompt"` — and a
 * gate that only knew the user role never fired for one, so a session opened
 * with a skill stayed unnamed (its row read "New Session - <timestamp>" in the
 * sidebar while the header showed the invocation). The chip a skill turn stands
 * for is `/skill:<name> <args>`, which is the text omp itself titles from.
 *
 * The latch makes a later user message (a queued steer) a no-op, and a session
 * that resumed an existing conversation is ineligible from the start. The
 * terminal `agent_end` retries if this attempt produced nothing.
 */
function handleMessageEnd(host: SessionFrameHost, event: AgentEvent): void {
  const message = event.message as Record<string, unknown> | undefined;
  if (message?.role === 'user') void triggerAutoSessionTitle(host, 'opening');
  else if (message?.role === 'custom' && message.customType === SKILL_PROMPT_CUSTOM_TYPE) {
    void triggerAutoSessionTitle(host, 'opening');
  }
}

/**
 * The `tool_execution_end` branch: the panels catch up per tool call, not only
 * at the turn boundary.
 *
 * A completed tool call may have touched the working tree, and a long run can go
 * many minutes between turn boundaries — the git/files panels were blind until
 * `agent_end`. Emitting here lets the publish pipeline's own coalescing (120ms
 * per topic, identical-payload dedupe) collapse a burst of tool calls into one
 * re-read; only SUBSCRIBED topics are resolved, so a tab with no git/files panel
 * pays nothing. The session's data topics (todos, telemetry, queue) stay
 * turn-boundary-only on purpose: their resolvers are the expensive ones
 * (whole-transcript parses/scans).
 */
function handleToolExecutionEnd(host: SessionFrameHost): void {
  emitRealtimeSignal('workspace-dirty');
  // The transcript appended too — the sidebar's `updated_at` (its ordering and
  // time-ago labels) is read off a scan that only re-runs on this signal, and
  // the sessions watcher deliberately ignores transcript appends. The coalesce +
  // dedupe above bound the cost the same way.
  publishSidebarStructure();
  // The session's DATA moved as well: a tool result is a transcript entry, so
  // the raw-messages paged view and the session-data topics re-read. Their
  // resolvers are the expensive ones (whole-transcript parses), but the
  // coalesce + dedupe bound them the same way, and a payload that did not change
  // publishes nothing.
  if (host.sessionId) emitRealtimeSignal('session-data-dirty', host.sessionId);
}

/**
 * The `prompt_result` branch: whether this frame may reach the client.
 *
 * omp answers EVERY prompt that opened no turn on this frame, and most of them
 * are Kabmo's own background work: the auto-title `/rename` (fired right
 * after the first settled user message), a Plan/Goal mode toggle,
 * `/reload-plugins`, `rename-with-ai`, a peer instance's command. Forwarding one
 * tells the CLIENT that its prompt opened no turn; its fold then settles the
 * optimistic turn — blanking the docked generating indicator, releasing the
 * `stream` mark the sidebar's spinner hangs on and dropping the optimistic user
 * mark, so the turn's own echo is appended beside the bubble it stood for.
 * Measured on a fresh session (omp 18.7.0): the indicator died ~450 ms into a
 * 20 s run, and the first prompt was stored twice in Kabmo's copy of the
 * conversation.
 *
 * The RUN is the attribution, and it covers every sender: while the operator's
 * turn is streaming, a prompt that opened no turn cannot be the settle of the
 * turn they are watching. The auto-title request window is not sufficient on its
 * own — it is armed around the `/rename`, and omp answers it in the same tick
 * (~3 ms), so a frame that won that race reached the client regardless (the leak
 * this replaces). Its flags are left alone too, exactly as the dispatcher leaves
 * a non-owning command's (see `session-commands.ts`): the live run owns them.
 *
 * A builtin the operator typed while the agent is IDLE still passes through
 * untouched — the case this frame exists for.
 */
function handlePromptResult(host: SessionFrameHost, event: AgentEvent): boolean {
  if (event.agentInvoked === false && host.streaming) return true;
  host.promptRunning = false;
  host.awaitingAgentStart = false;
  host.awaitingAgentStartDeadline = 0;
  // The PROMPT ACK never says `agentInvoked`; this frame is what does, and it
  // arrives after it. A `false` here is omp's own word that the prompt opened no
  // turn — so the `stream` row the dispatch wrote must go. That row's owner is
  // ALIVE, so `healStaleStreamStatuses` can never reach it and this frame is the
  // only thing that can: without it the spinner turns forever. See
  // `releasesStreamRowOnPromptResult` for the two senders and the `!streaming`
  // guard.
  if (releasesStreamRowOnPromptResult(event, host)) void clearStreamStatus(host.sessionId);
  return false;
}

/** Apply one frame to the wrapper's runtime state. */
export function foldSessionFrame(host: SessionFrameHost, event: AgentEvent): FrameFoldResult {
  const result: FrameFoldResult = { suppressForward: false };

  switch (event.type) {
    case 'agent_start':
      host.promptRunning = true;
      host.streaming = true;
      host.awaitingAgentStart = false;
      host.awaitingAgentStartDeadline = 0;
      host.continuationGraceUntil = 0;
      // One early auto-title attempt per run, not per conversation: the flag is
      // reset here so a run that opens after an aborted one (which skipped the
      // settle attempt) still gets its own early try. The eligibility latch is
      // what bounds this to the conversation's first run.
      host.autoTitleRequested = false;
      clearSessionFileCaches();
      if (host.sessionId) void markStreamStatus(host.sessionId, 'stream');
      // Belt for a switch omp did not announce: a fallback that landed between
      // runs leaves `runModel` (and the row the indicator names the run by) on
      // the pre-fallback model. `model_changed` covers the switches omp reports;
      // this makes the run's own opening frame re-read the truth before the
      // first token, so the indicator cannot inherit a stale pair.
      host.syncRunModel();
      break;
    case 'turn_start':
      // Redundant with agent_start in the happy path, but the run-level
      // counterpart can be missed (e.g. the state was cleared by a command
      // between frames). The turn is proof enough the session is live.
      if (host.sessionId) void markStreamStatus(host.sessionId, 'stream');
      break;
    case 'message_start':
      // Same recovery as turn_start: a message frame is only emitted inside a
      // live run, so its arrival re-arms the `stream` row no matter what stale
      // status sits there (upsert overwrites any terminal badge).
      if (host.sessionId) void markStreamStatus(host.sessionId, 'stream');
      break;
    case 'message_end':
      handleMessageEnd(host, event);
      break;
    case 'tool_execution_end':
      handleToolExecutionEnd(host);
      break;
    // `turn_end` is deliberately NOT handled here: a multi-turn run emits it for
    // EVERY turn (verified against omp 18.2.8: agent_start → turn_start →
    // turn_end('toolUse') → turn_start → turn_end('stop') → agent_end) and the
    // frame carries no isTerminal field, so no turn-level stopReason can be read
    // as "the run is over". The terminal badge is written from `agent_end`
    // alone (`markEndStatus` in terminal-settle.ts), which is the only frame that
    // knows.
    case 'agent_end':
      if (event.isTerminal !== false) {
        host.streaming = false;
        host.promptRunning = false;
        host.awaitingAgentStart = false;
        host.awaitingAgentStartDeadline = 0;
        host.continuationGraceUntil = 0;
        clearSessionFileCaches();
        settleTerminalRun(host, event.messages);
      } else {
        host.continuationGraceUntil = Date.now() + NON_TERMINAL_CONTINUATION_GRACE_MS;
      }
      break;
    case 'prompt_result':
      result.suppressForward = handlePromptResult(host, event);
      break;
    case 'auto_compaction_start':
      host.compacting = true;
      break;
    case 'auto_compaction_end':
      host.compacting = false;
      clearSessionFileCaches();
      break;
    case 'command_output':
      // A `command_output` for a command the OPERATOR typed renders as a notice
      // row. But Kabmo fires its own `/rename` in the background, and omp
      // answers it on the same frame — "Session renamed to …", or "Could not
      // generate a session title" for a low-signal first message. Neither was
      // asked for, and the second would be pure noise. The frame carries no
      // correlation id, so attribution is by the request window.
      result.suppressForward = consumeAutoTitleOutput(host);
      break;
    case 'model_changed':
      // omp swapped the model under us: a retry under `retry.fallbackChains`
      // picks the next eligible model when the primary fails, and can do it
      // MID-RUN. The frame carries NO payload, so the wrapper re-reads
      // `get_state` and renames the live run row — the sidebar and the
      // generating indicator must name the model the answer came from, not the
      // one that was requested.
      host.syncRunModel();
      break;
    case 'session_info_update':
      // A rename rewrote the fixed-width title slot in place; the scan cache is
      // keyed on file mtime, which that write cannot move, so the list must be
      // rebuilt explicitly.
      clearSessionFileCaches();
      break;
    // omp's own goal transitions. The wrapper keeps the record so a snapshot
    // (`get_state` plus the live frame) can report the mode without a round
    // trip, and so the idle reaper can see that a goal is still live. The frame
    // is forwarded as-is: the client folds it into the composer's mode state.
    case 'goal_updated':
      host.modeMirror.observe(event);
      break;
    case 'extension_ui_request': {
      // The Kabmo's mode extension reports every plan/goal transition through
      // `ctx.ui.notify`, which omp frames as an `extension_ui_request` with
      // `method: "notify"`. The client parses those into composer state; the
      // wrapper mirrors them for the same reason it mirrors `goal_updated` —
      // this is the only live word on PLAN mode (omp emits no plan event), and
      // the only place a goal RECORD is carried, so it is what a `GET /modes`
      // can answer from while the transcript does not exist yet.
      const data = event as { method?: unknown; message?: unknown };
      if (data.method === 'notify') {
        const marker = parseModeMarker(typeof data.message === 'string' ? data.message : '');
        if (marker) host.modeMirror.observeMarker(marker);
      }
      host.trackUiDialog(event);
      break;
    }
    // Subagent frames carry no turn state, but they are the only proof that
    // work is still running once the parent turn has ended.
    case 'subagent_lifecycle':
    case 'subagent_progress':
    case 'subagent_event':
      host.observeSubagent(event, Date.now());
      break;
    case 'response': {
      if (event.success === false && event.command === 'prompt') {
        host.promptRunning = false;
        host.awaitingAgentStart = false;
        host.awaitingAgentStartDeadline = 0;
        host.emit({ type: 'prompt_error', errorMessage: (event.error as string) ?? 'Prompt failed' });
        // The caller's trailing notify covers this: promptRunning just flipped,
        // so the running snapshot changes and the listeners fire. Suppress only
        // the forward, or the error would land twice.
        result.suppressForward = true;
      }
      break;
    }
  }

  return result;
}
