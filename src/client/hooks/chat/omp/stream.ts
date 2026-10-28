/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Live agent stream wiring for the omp bridge.
 *
 * The session's frames ride the unified realtime socket's `session:<id>` topic
 * — the same connection the sidebar and every panel use — instead of a socket
 * or SSE stream of its own. One tab therefore holds ONE socket regardless of
 * how many features are live.
 *
 * The topic is an EVENT STREAM, not a value, so it is consumed through
 * `subscribeFrames`: every `message_update` / `tool_execution_end` must be
 * folded, and the value API's "keep the latest payload" would drop the run.
 *
 * The topic's SNAPSHOT is the reattach payload (`buildAgentSnapshot`, the same
 * builder `GET /api/agent/:sessionId` answers from): it says whether the run is
 * live, and it replays the ask/approval dialogs omp will never re-emit. That
 * makes subscribing safe BEFORE the child exists — the snapshot is
 * `running:false`, and the spawn path re-snapshots the topic once the child is
 * reachable — which is what the old 409-refusal workaround existed to avoid.
 */

import { useCallback, useEffect, useRef } from 'preact/hooks';
import type { Dispatch, RefObject, SetStateAction } from 'preact/compat';
import type { ChatMessageData, OmpAgentCallbacks, OmpAgentEvent, OmpAgentState } from '@/shared/types';
import type { ExtensionUiDialogRequest } from '@/shared/types/omp/agent';
import { foldAgentEvent, type ToolResultRecord } from '@/shared/lib/chat/omp/agent-events';
import { realtimeClient, type RealtimeFrame } from '@/shared/lib/realtime/client';
import { sessionTopic } from '@/shared/lib/realtime/protocol';

/** The reattach payload `session:<id>`'s snapshot carries. */
interface AgentTopicSnapshot {
  running?: boolean;
  busy?: boolean;
  state?: { isStreaming?: boolean; isPromptRunning?: boolean };
  pendingUiRequests?: ExtensionUiDialogRequest[];
}

export interface OmpStreamRefs {
  toolResultsRef: RefObject<Map<string, ToolResultRecord>>;
  lastToolMessageRef: RefObject<ChatMessageData>;
  /** Last activity phrase published to the indicator (repeat suppression). */
  activityRef: RefObject<string>;
  /** Live thinking level (last `thinking_level_changed` frame). */
  currentThinkingLevelRef: RefObject<string | undefined>;
  /** Phrase for an open provider-retry saga, or null (see `fold-deps.ts`). */
  providerRetryVerbRef: RefObject<string | null>;
  /**
   * The transcript row owning a call this fold never streamed — a run resumed
   * after a page reload. See `ToolResultHost.resumedToolMessage`.
   */
  resumedToolMessage?: (callId: string) => ChatMessageData | undefined;
}

interface UseOmpAgentStreamOptions extends OmpStreamRefs {
  setState: Dispatch<SetStateAction<OmpAgentState>>;
  callbacksRef: RefObject<OmpAgentCallbacks>;
}

export function useOmpAgentStream({
  setState,
  callbacksRef,
  toolResultsRef,
  lastToolMessageRef,
  activityRef,
  currentThinkingLevelRef,
  providerRetryVerbRef,
  resumedToolMessage,
}: UseOmpAgentStreamOptions) {
  /** The session this hook is currently attached to, or null. */
  const attachedRef = useRef<string | null>(null);
  /** Cleanup of the live frame subscription. */
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const disconnect = useCallback(() => {
    const unsubscribe = unsubscribeRef.current;
    unsubscribeRef.current = null;
    attachedRef.current = null;
    unsubscribe?.();
    setState((prev) => ({ ...prev, connected: false }));
  }, [setState]);

  const connect = useCallback((sid: string) => {
    if (attachedRef.current === sid) return;
    disconnect();
    attachedRef.current = sid;

    unsubscribeRef.current = realtimeClient.subscribeFrames(sessionTopic(sid), (frame: RealtimeFrame) => {
      // The snapshot is the reattach payload, not an omp event: it decides
      // whether to resume the generating UI and replays blocked dialogs.
      if (frame.kind === 'snapshot') {
        const snapshot = frame.payload as AgentTopicSnapshot | null;
        const callbacks = callbacksRef.current;
        setState((prev) => ({ ...prev, connected: true }));
        callbacks?.onConnected?.();
        if (!snapshot?.running) return;
        const probe = snapshot.state;
        // `busy` is NOT run evidence, and must never resume the generating UI.
        // The server sets it whenever a probe would otherwise have to queue a
        // `get_state` behind work already in flight — which includes a live
        // SUBAGENT whose parent turn has ended, and a dialog a reloaded client
        // has not answered yet. Reading it as "a run is in flight" drew the
        // `•Thinking…` indicator over a finished session and only released it
        // when the child's subagent went stale (SUBAGENT_STALE_MS, 30 min).
        // A real run always shows up in one of these two flags.
        if (probe?.isStreaming || probe?.isPromptRunning) {
          callbacks?.onResumeStream?.();
        }
        // An ask/approval dialog raised before the reload is still blocking the
        // agent, and omp never re-sends the frame: replay what the server
        // remembered so the modal reappears instead of the run hanging.
        for (const request of snapshot.pendingUiRequests ?? []) {
          callbacks?.onExtensionUiRequest?.(request);
        }
        return;
      }

      // The child streams FULL accumulated `message_update` frames (see
      // `child-config.ts`), so the payload folds as-is — no rebuild.
      foldAgentEvent(frame.payload as OmpAgentEvent, {
        sessionId: sid,
        setState,
        callbacksRef,
        toolResultsRef,
        lastToolMessageRef,
        activityRef,
        currentThinkingLevelRef,
        providerRetryVerbRef,
        resumedToolMessage,
      });
    });

    setState((prev) => ({ ...prev, connected: true }));
  }, [disconnect, setState, callbacksRef, toolResultsRef, lastToolMessageRef, activityRef, currentThinkingLevelRef, providerRetryVerbRef, resumedToolMessage]);

  // The subscription outlives a session switch only through `connect`'s own
  // disconnect, so an unmount has to release it explicitly.
  useEffect(() => () => disconnect(), [disconnect]);

  /** The session this hook is streaming right now, or null.
   *
   *  `useOmpAgent` reads it to tell a session SWITCH from the arrival of the id
   *  a spawn just answered with: the spawn path calls `connect(sid)` before the
   *  URL carries that id, so "already attached to this exact session" is proof
   *  the frames on screen belong to the conversation being opened — a
   *  distinction no pending-id bookkeeping can make for a send that started
   *  with no `?sessionId=` at all. */
  const attachedSession = useCallback(() => attachedRef.current, []);

  return { connect, disconnect, attachedSession };
}

export type { ToolResultRecord };
