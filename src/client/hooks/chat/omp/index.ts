import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { AgentImage, ChatMessageData, OmpAgentCallbacks, OmpAgentHandle, OmpAgentState, PromptDispatchResult } from '@/shared/types';
import type { ExtensionUiDialogRequest } from '@/shared/types/omp/agent';
import { type ToolResultRecord, useOmpAgentStream } from '@/client/hooks/chat/omp/stream';
import { useOmpPromptSender } from '@/client/hooks/chat/omp/prompt-send';
import { stopAgentSession } from '@/shared/lib/chat/omp/abort';
import { isSpawnAdoption } from '@/client/hooks/chat/omp/pending-sessions';

/**
 * Client-side cap on a steer request, above the server's own `STEER_ACK_TIMEOUT_MS`
 * (15 s) so the server's own answer — a refusal naming a pending dialog, or
 * omp's bounded ack — normally wins the race and the timeout here only catches
 * a request the server never answered at all (a dropped connection, a wedged
 * listener). Kept above the server's cap deliberately: this is the last resort,
 * not the mechanism.
 */
const STEER_REQUEST_TIMEOUT_MS = 25_000;

/**
 * Live omp agent bridge for the chamber chat (real mode, MOCK=false). Mirrors
 * the omp-web useAgentSession streaming surface: send a prompt over the RPC
 * bridge (POST /api/agent/:sessionId), consume agent events over the configured
 * the realtime channel, and fold them into ChatMessageData — one "current assistant
 * message" replaced per message_update, finalized on message_end / agent_end.
 */

export type { ExtensionUiDialogMethod, ExtensionUiDialogRequest, IncomingExtensionUiRequest } from '@/shared/types/omp/agent';
export type { OmpAgentCallbacks, OmpAgentEvent, OmpAgentState } from '@/shared/types/omp/agent';

export function useOmpAgent(sessionId: string | null, callbacks: OmpAgentCallbacks): OmpAgentHandle {
  const [state, setState] = useState<OmpAgentState>({ isGenerating: false, connected: false, error: null });
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  // Tool results arrive as separate events (tool_execution_end) or as
  // toolResult messages AFTER the assistant message with the toolCall block.
  // Accumulate them here and merge into the matching tool call on message_end.
  const toolResultsRef = useRef<Map<string, ToolResultRecord>>(new Map());
  // Last assistant message that carried tool calls, so tool_execution_end
  // events arriving after message_end can re-emit it with the result paired.
  const lastToolMessageRef = useRef<ChatMessageData | null>(null);
  // Last phrase handed to the indicator; the fold compares against it so
  // per-token frames cannot spam state updates with the same string.
  const activityRef = useRef('');
  const currentThinkingLevelRef = useRef<string | undefined>(undefined); // live thinking level (last `thinking_level_changed`)
  // Phrase for an open provider-retry saga; while set it outranks the activity
  // the doomed attempt names (see `fold-deps.ts`).
  const providerRetryVerbRef = useRef<string | null>(null);
  const { connect, disconnect } = useOmpAgentStream({
    setState,
    callbacksRef,
    toolResultsRef,
    lastToolMessageRef,
    activityRef,
    currentThinkingLevelRef,
    providerRetryVerbRef,
  });

  /** The session id this hook last prepared refs for, so an ADOPTION can be
   *  told from a real switch. */
  const preparedSessionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    // A spawn adoption is the SAME conversation under a new id: the first send
    // created `new-…`, the spawn answered with omp's UUID, and the URL moved.
    // Clearing here threw away the run's own bookkeeping in the middle of the
    // first turn — measured in a browser spec, the tool-call map was emptied
    // between two progress frames, so every later `tool_execution_update`/`_end`
    // had no target to pair onto and the card froze at `running` for the rest of
    // the session. The stream is not re-dialled either: the frames for the
    // adopted id are already arriving on the subscription this hook holds.
    const previous = preparedSessionRef.current;
    preparedSessionRef.current = sessionId;
    if (previous && isSpawnAdoption(previous, sessionId)) return;

    // Session changed (or first mount): drop the previous session's tool
    // results. On first mount the refs are already empty, so this cannot disturb
    // a resumed session's reattach below.
    toolResultsRef.current.clear();
    lastToolMessageRef.current = null;
    activityRef.current = '';
    // Do NOT auto-connect here: the stream endpoint refuses (409) until the
    // session's omp process is spawned (POST /api/agent/:id), and a client
    // dialing a refused endpoint loops network errors in the console.
    // connect() is called lazily by sendPrompt after the spawn succeeds.
    let cancelled = false;
    // Reload/remount recovery: the omp process keeps running server-side
    // after a page refresh, so a mid-run session must reattach its event
    // stream or the in-flight response appears frozen. Probe get_state; when the
    // wrapper reports streaming/prompt-running, reconnect and let the caller
    // resume the generating UI.
    fetch(`/api/agent/${encodeURIComponent(sessionId)}`)
      .then(res => (res.ok ? res.json() : null))
      .then((data: {
        running?: boolean;
        /** Set when the server answered from local flags, not a get_state RPC. */
        busy?: boolean;
        state?: { isStreaming?: boolean; isPromptRunning?: boolean };
        pendingUiRequests?: ExtensionUiDialogRequest[];
      } | null) => {
        if (cancelled || !data?.running) return;
        const probe = data.state;
        // Attach when there is anything live to receive: a run, or work a probe
        // would queue behind (a subagent, an unanswered dialog). Attaching is
        // how this tab starts receiving that session's frames.
        if (data.busy || probe?.isStreaming || probe?.isPromptRunning) {
          connect(sessionId);
        }
        // Resuming the GENERATING UI is a different question, and `busy` is not
        // run evidence: the server sets it for a live subagent whose parent turn
        // has already ended, and for a dialog a reloaded client has not answered.
        // Reading it as "a run is in flight" drew `•Thinking…` over a finished
        // session until the subagent went stale (SUBAGENT_STALE_MS, 30 min).
        // A real run always sets one of these two flags.
        if (probe?.isStreaming || probe?.isPromptRunning) {
          callbacksRef.current.onResumeStream?.();
        }
        // An ask/approval dialog raised before the reload is still blocking the
        // agent, and omp never re-sends the frame: replay what the server
        // remembered so the modal reappears instead of the run hanging.
        for (const request of data.pendingUiRequests ?? []) {
          callbacksRef.current.onExtensionUiRequest?.(request);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      disconnect();
    };
  }, [sessionId, disconnect, connect]);

  // Prompt delivery (warm-up + stream attach + the dispatch-time sidebar
  // signal) lives in its own module so this hook stays under the size ceiling.
  const { sendPrompt, sendNewPrompt } = useOmpPromptSender({ sessionIdRef, connect, setState });

  /** Abort the running agent turn. */
  const abort = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    // Self-escalating: a child that does not stop within the helper's grace
    // period is reset instead, so a wedged session cannot hang the button.
    await stopAgentSession(sid);
    setState((prev) => ({ ...prev, isGenerating: false }));
  }, []);

  /**
   * Steer the running agent: deliver the message INTO the turn in flight.
   *
   * This is omp's own `steer` command, and it is a different operation from
   * what this used to send. It posted `abort_and_prompt`, which CANCELS the
   * turn and starts a new one — so "Send Now (Steering)" on a queued row threw
   * away the answer the user was watching. Measured on omp 18.8.3 with a
   * counting turn: `steer` produced one `agent_start` and one `agent_end` with
   * the model answering the steer inside the same run, while `abort_and_prompt`
   * produced two of each.
   *
   * `steer` also reaches the model without a synthetic user row of its own:
   * omp queues it (`queue_update` reports it under `steering`, then clears when
   * consumed) and surfaces it as a user turn of the run.
   *
   * A pending ask/approval dialog is refused by the SERVER
   * (`session_blocked_on_dialog`): omp parks its whole command loop on one, so
   * this request would otherwise hang until the user answered the dialog. The
   * fetch carries its own abort signal for the same reason — a server that
   * cannot answer must not leave the caller waiting forever. */
  const steerOmpRun = useCallback(async (
    message: string,
    images?: AgentImage[],
  ): Promise<PromptDispatchResult> => {
    const sid = sessionIdRef.current;
    if (!sid) return { ok: false, busy: false, error: 'No live session' };
    try {
      const res = await fetch(`/api/agent/${encodeURIComponent(sid)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'steer',
          message,
          ...(images?.length ? { images } : {}),
        }),
        signal: AbortSignal.timeout(STEER_REQUEST_TIMEOUT_MS),
      });
      const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; code?: string };
      if (!res.ok || body.error) return { ok: false, busy: false, error: body.error ?? `HTTP ${res.status}` };
      return { ok: true, busy: false };
    } catch (e) {
      // A timeout is the one outcome that is NOT proof of loss: the server
      // bounded omp's ack, and omp queues the steer before it parks, so the
      // message may well be running. Flagged rather than called a failure.
      const timedOut = e instanceof DOMException && e.name === 'TimeoutError';
      const error = timedOut
        ? 'not acknowledged in time — it may still be running'
        : e instanceof Error ? e.message : String(e);
      return timedOut ? { ok: false, busy: false, error, uncertain: true } : { ok: false, busy: false, error };
    }
  }, []);

  /** Set the model for the live session (set_model RPC). */
  const setModel = useCallback(async (provider: string, modelId: string) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await fetch(`/api/agent/${encodeURIComponent(sid)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'set_model', provider, modelId }),
      });
    } catch {
      // Model change is best-effort; the next get_state reconciles.
    }
  }, []);

  /** Set the thinking level for the live session (set_thinking_level RPC). */
  const setThinkingLevel = useCallback(async (level: string) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await fetch(`/api/agent/${encodeURIComponent(sid)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'set_thinking_level', level }),
      });
    } catch {
      // Best-effort; "auto" leaves omp's current setting untouched.
    }
  }, []);

  /** Jawab dialog ask/approval (extension_ui_response) — melepas blocking tool call. */
  const respondToExtensionUi = useCallback(async (
    request: ExtensionUiDialogRequest,
    response:
      | { value: string }
      | { confirmed: boolean }
      | { cancelled: true }
      | { answers: { id: string; selectedOptions: string[]; customInput?: string }[] },
  ): Promise<void> => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await fetch(`/api/agent/${encodeURIComponent(sid)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'extension_ui_response', id: request.id, ...response }),
      });
    } catch {
      // Best-effort; omp surfaces the failure on its side.
    }
  }, []);

  return {
    ...state,
    sendPrompt,
    sendNewPrompt,
    steerOmpRun,
    abort,
    setModel,
    setThinkingLevel,
    respondToExtensionUi,
    disconnect,
  };
}
