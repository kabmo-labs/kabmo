/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Folds one live agent event frame into chamber state. Transport-agnostic: the
 * WebSocket and SSE clients both hand every decoded frame to `foldAgentEvent`,
 * so both transports produce byte-identical timeline behavior.
 *
 * Split out of useOmpAgentStream so the hook owns only connection lifecycle
 * (open, reconnect, teardown) and each file stays under the repo's per-file
 * size ceiling.
 */

import type { IncomingExtensionUiRequest, OmpAgentEvent, ToolCallData } from '@/shared/types';
import { extractTextFromContent, toChatMessage, toolResultText } from '@/shared/lib/omp/session/mapper';
import { normalizeNoticeText } from '@/shared/lib/chat/notice-text';
import { parseChamberMarker } from '@/shared/lib/omp/mode/markers';
import { emitChamberModeSignal } from '@/shared/lib/omp/mode/client-signal';
import { materializeTerminalMessages } from '@/shared/lib/chat/omp/terminal-messages';
import { invalidateComposerCache } from '@/shared/lib/chat/composer/client';
import { setActivity, toolHost, type OmpAgentFoldDeps } from '@/shared/lib/chat/omp/fold-deps';
import { normalizeThinkingLevel } from '@/shared/lib/models/thinking-levels';
import { endRetrySaga, foldAutoRetry } from '@/shared/lib/chat/timeline/provider-retry';
import { foldTransportFrame } from '@/shared/lib/chat/omp/transport-frames';
import { PHASE_VERBS } from '@/shared/lib/chat/timeline/tool-phrases';
import { describeAssistantPhase, describeToolActivity } from '@/shared/lib/chat/timeline/tool-verbs';
import { extractToolImages } from '@/shared/lib/omp/session/tool-images';
import { publishSubagentFrame } from '@/shared/lib/chat/omp/subagent-frames';
import {
  pairToolOutputs,
  putToolResult,
  recordToolResult,
  refreshToolMessage,
  resultDetails,
} from '@/shared/lib/chat/omp/tool-results';

// Re-exported so stream.ts and the timeline hook keep their existing import
// site; the implementation lives in tool-results.ts.
export type { ToolResultRecord } from '@/shared/lib/chat/omp/tool-results';
export type { OmpAgentFoldDeps } from '@/shared/lib/chat/omp/fold-deps';

export function foldAgentEvent(data: OmpAgentEvent, deps: OmpAgentFoldDeps): void {
  const callbacks = deps.callbacksRef.current;
  switch (data.type) {
    case 'agent_start':
      deps.setState((prev) => ({ ...prev, isGenerating: true, error: null }));
      deps.toolResultsRef.current?.clear();
      deps.lastToolMessageRef.current = null;
      // A fresh run restarts level tracking; the first turn relies on the
      // session-level value until omp emits thinking_level_changed (or not).
      deps.currentThinkingLevelRef.current = undefined;
      // The callback publishes its own "Thinking" phrase, so the fold's one has
      // to come AFTER it: every retry of a saga re-enters here with an
      // `agent_start`, and a direct write would otherwise wipe the retry phrase
      // `setActivity` exists to keep (see `providerRetryVerbRef`).
      callbacks?.onAgentStart?.();
      setActivity(PHASE_VERBS.thinking, deps);
      break;

    case 'turn_start':
      setActivity(PHASE_VERBS.thinking, deps);
      callbacks?.onTurnStart?.();
      break;

    case 'message_start':
    case 'message_update': {
      const msg = data.message as Record<string, unknown> | undefined;
      if (!msg) break;
      if (msg.role === 'toolResult') {
        recordToolResult(msg, deps);
        setActivity(PHASE_VERBS.thinking, deps);
        break;
      }
      // Assistant phases (thinking / prose / tool-call assembly) name the
      // action directly — a tool that never starts still shows its phrase.
      setActivity(describeAssistantPhase(data.assistantMessageEvent), deps);
      // The first message frame of a turn is another proof the run is live —
      // re-signal so the sidebar can restore a lost `stream` status row.
      // message_update frames arrive per delta and must stay silent here.
      if (data.type === 'message_start') callbacks?.onTurnStart?.();
      // Steering (abort_and_prompt) and follow-up deliveries create no
      // optimistic bubble — the user turn only exists on the stream. Convert
      // it here so the bubble renders live instead of after a JSONL reload.
      // The callbacks append user rows (never overwrite the streaming AI
      // placeholder) and dedup by omp message id.
      const converted = toChatMessage(msg);
      if (converted) {
        if (converted.role !== 'user' && deps.currentThinkingLevelRef.current) {
          converted.thinkingLevel = deps.currentThinkingLevelRef.current;
        }
        callbacks?.onMessageUpdate?.(converted);
      }
      break;
    }

    case 'message_end': {
      const completed = data.message as Record<string, unknown> | undefined;
      if (!completed) break;
      if (completed.role === 'toolResult') {
        recordToolResult(completed, toolHost(deps));
        // Re-pair the card now. omp sends this frame AFTER `tool_execution_end`,
        // but the two are independent, and a result that arrived first (or a
        // build whose `_end` frame carried no details) must still reach the row
        // that is on screen.
        refreshToolMessage(typeof completed.toolCallId === 'string' ? completed.toolCallId : undefined, toolHost(deps));
        break;
      }
      if (completed.role === 'custom') break;
      if (completed.role === 'user') {
        const delivered = extractTextFromContent(completed.content);
        if (delivered) callbacks?.onQueuedMessageDelivered?.(delivered);
        break;
      }
      const converted = toChatMessage(completed, false);
      if (!converted) break;
      if (converted.role !== 'user' && deps.currentThinkingLevelRef.current) {
        converted.thinkingLevel = deps.currentThinkingLevelRef.current;
      }
      const paired = pairToolOutputs(converted, deps);
      if (paired.toolCalls?.length) deps.lastToolMessageRef.current = paired;
      callbacks?.onMessageEnd?.(paired);
      break;
    }

    case 'tool_execution_start': {
      const callId = typeof data.toolCallId === 'string' ? data.toolCallId : undefined;
      setActivity(describeToolActivity({
        name: typeof data.toolName === 'string' ? data.toolName : undefined,
        args: data.args,
        intent: typeof data.intent === 'string' ? data.intent : undefined,
      }), deps);
      if (callId) deps.toolResultsRef.current?.set(callId, { output: '' });
      const last = deps.lastToolMessageRef.current;
      if (last?.toolCalls?.some(tc => tc.id === callId)) {
        deps.lastToolMessageRef.current = {
          ...last,
          toolCalls: last.toolCalls.map(tc => ({ ...tc, status: 'running' as ToolCallData['status'] })),
        };
        callbacks?.onMessageUpdate?.(deps.lastToolMessageRef.current);
      }
      break;
    }

    case 'tool_execution_update': {
      const callId = typeof data.toolCallId === 'string' ? data.toolCallId : undefined;
      const partial = toolResultText(data.partialResult);
      if (!callId || !partial) break;
      // `partialResult` is the tool's output SO FAR, not the fragment since the
      // last update — omp hands over a full snapshot on every frame (measured
      // on 18.3.0 and 18.8.3: a bash loop echoing one line a second reports
      // "L1", then "L1\nL2", then "L1\nL2\nL3"). Appending the snapshot to what
      // is already stored renders the running card as interleaved text
      // ("L1\nL1\nL2\nL1\nL2\nL3"), which is what a long command looked like
      // until its `tool_execution_end` overwrote the record.
      putToolResult(deps, callId, { output: partial });
      refreshToolMessage(callId, toolHost(deps));
      break;
    }

    case 'tool_execution_end': {
      const callId = typeof data.toolCallId === 'string' ? data.toolCallId : undefined;
      if (!callId) break;
      setActivity(PHASE_VERBS.thinking, deps);
      const images = extractToolImages(data.result);
      putToolResult(deps, callId, {
        output: toolResultText(data.result),
        isError: data.isError === true,
        details: resultDetails(data),
        ...(images.length > 0 ? { images } : {}),
      });
      refreshToolMessage(callId, toolHost(deps));
      break;
    }

    case 'agent_end': {
      // A NON-TERMINAL `agent_end` is not the end of the run: omp emits it when
      // the turn yields but work is still alive — a detached subagent, a
      // compaction, a background job, or a stop-time reminder — and a later
      // `agent_start` opens the continuation. Measured on omp 18.3.2: with an
      // async subagent, `agent_end isTerminal=false` arrives ~13s BEFORE the
      // subagent's terminal frame, and clearing the generating state there
      // blanked the indicator for the whole stretch the roster was still
      // showing a live child. The server's own fold gates on the same field
      // (frame-fold.ts), so the two ends now agree.
      if (data.isTerminal === false) break;
      // A retry saga cannot survive the run: a terminal end may arrive with no
      // `auto_retry_end` in front of it.
      endRetrySaga(deps);
      deps.setState((prev) => ({ ...prev, isGenerating: false }));
      deps.activityRef.current = '';
      const terminal = materializeTerminalMessages(data, deps, callbacks ?? undefined);
      callbacks?.onAgentEnd?.({
        errorMessage: terminal.errorMessage
          ?? (typeof data.errorMessage === 'string' ? data.errorMessage : undefined),
        message: typeof data.message === 'string' ? data.message : undefined,
      });
      break;
    }

    case 'prompt_error': {
      const errorMessage = typeof data.errorMessage === 'string' ? data.errorMessage : 'Prompt failed';
      deps.setState((prev) => ({ ...prev, isGenerating: false, error: errorMessage }));
      deps.activityRef.current = '';
      callbacks?.onPromptError?.(errorMessage);
      break;
    }

    // omp's prompt ack ran a built-in slash command instead of an agent turn
    // (`agentInvoked:false`, mirrored server-side as this frame): there will be
    // no agent_start/agent_end pair. Clear the optimistic generating state —
    // the callbacks drop the AI placeholder and keep the user's message row.
    case 'prompt_result': {
      if (data.agentInvoked === false) {
        deps.setState((prev) => ({ ...prev, isGenerating: false }));
        deps.activityRef.current = '';
        callbacks?.onPromptSettled?.();
      }
      break;
    }

    // omp replays a transient provider error by itself — rate limit, outage,
    // quota wall — and keeps the RUN open across the attempts: each retry
    // announces itself here and opens a fresh `agent_start`, with no `agent_end`
    // in between. Without this the indicator stayed on the generic "Thinking…"
    // for the whole stall, over a transcript whose last row was the failure.
    // See `provider-retry.ts` for the phrase and the one-row-per-saga rule.
    case 'auto_retry_start':
    case 'auto_retry_end':
      foldAutoRetry(data, deps);
      break;

    // Built-in slash command output (/usage, /compact result, …). Rendered as
    // a notice row — see the callback type note: this frame is the ONLY copy.
    // `normalizeNoticeText` strips the terminal formatting omp emits here; the
    // reload path applies the same function so both agree.
    case 'command_output': {
      const text = typeof data.text === 'string' ? normalizeNoticeText(data.text) : '';
      if (text) callbacks?.onCommandOutput?.(text);
      break;
    }

    // omp renamed the session (auto-title generation, /rename, set_session_name).
    // Nothing in the timeline changes, but the sidebar reads titles from the
    // session file — and the rename is a 256-byte in-place slot write that the
    // scan cache's mtime key cannot see — so this frame is the only push
    // signal that the list is stale.
    case 'session_info_update': {
      const title = typeof data.title === 'string' ? data.title.trim() : '';
      if (title) callbacks?.onSessionTitleChanged?.(title);
      break;
    }

    case 'notice': {
      callbacks?.onNotice?.(
        typeof data.level === 'string' ? data.level : 'info',
        typeof data.message === 'string' ? data.message : '',
      );
      break;
    }

    case 'extension_ui_request': {
      // The chamber's mode extension reports every plan/goal transition through
      // `ctx.ui.notify`, which omp frames as an `extension_ui_request` with
      // `method: "notify"` — NOT a `notice` frame (verified against omp 18.4.4:
      // `rpc-mode.ts`'s `notify` implementation emits exactly that).
      //
      // Those payloads are composer state, not conversation, so they are
      // intercepted here rather than handed to the dialog path: the dialog
      // renderer would paint a modal for a mode toggle. A marker whose payload
      // does not parse is NOT intercepted — it falls through as an ordinary
      // notify, so a version skew shows a readable line instead of silence.
      //
      // Delivered as a scoped window event (the shape the subagent frames use),
      // because the consumer is the composer's mode hook: routing it through
      // `callbacks` would thread a payload the timeline itself never reads
      // through four components.
      if ((data as { method?: unknown }).method === 'notify') {
        const message = typeof data.message === 'string' ? data.message : '';
        const marker = parseChamberMarker(message);
        if (marker) {
          emitChamberModeSignal(deps.sessionId, marker);
          break;
        }
      }
      callbacks?.onExtensionUiRequest?.(data as unknown as IncomingExtensionUiRequest);
      break;
    }

    case 'goal_evaluating': {
      // The chamber's auditor working on the turn that just ended. No model
      // turn is streaming while it runs, so without this frame the composer
      // would look idle during the seconds the check takes.
      emitChamberModeSignal(deps.sessionId, {
        marker: 'CHAMBER_GOAL_EVALUATING:',
        payload: { evaluating: data.evaluating === true },
      });
      break;
    }

    case 'subagent_lifecycle':
    case 'subagent_progress':
    case 'subagent_event': {
      // Forward live subagent frames to the subagent views through the module
      // bus. The frames already arrived over the `session:<id>` topic; this is
      // the second hop to the surfaces that render one child.
      const payload = data.payload;
      if (payload === undefined || payload === null || typeof payload !== 'object') break;
      publishSubagentFrame(data.type, { sessionId: deps.sessionId, payload });
      break;
    }

    case 'model_changed':
      callbacks?.onModelChanged?.();
      break;

    // The live `thinking_level_changed` frame carries the new session level
    // (e.g. { thinkingLevel: "high", configured, resolved }); null → "off".
    // Record it so subsequent assistant turns are stamped with the level that
    // actually served them — mirrors the JSONL `thinking_level_change` walk.
    case 'thinking_level_changed':
      deps.currentThinkingLevelRef.current = normalizeThinkingLevel(data.thinkingLevel);
      break;

    // omp emits this whenever the discovered command set changes — after
    // `/reload-plugins`, `/move`, or a skill install. The composer's command
    // pool is cached five minutes (`composer/client.ts`), so without this the
    // popup keeps offering the pre-change list.
    case 'available_commands_update':
      invalidateComposerCache('command');
      break;

    // Transport/extension frames (a dropped frame, a failed extension, the
    // session's own quiescence verdict) live in `transport-frames.ts`, which
    // also names the frames it deliberately ignores.
    default:
      foldTransportFrame(data, { foldDeps: deps });
      break;
  }
}
