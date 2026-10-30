/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * omp agent event surface types shared by useOmpAgent, Kabmo timeline
 * and the extension-dialog renderer. Kept separate so the hook file stays under
 * the repo's per-file size ceiling.
 */

import type { ChatMessageData } from '@/shared/types/chat';
import type { ApprovalMode } from '@/shared/lib/omp/config/access-mode';

/** One frame of the live agent event stream (WebSocket or SSE). */
export interface OmpAgentEvent {
  type: string;
  [key: string]: unknown;
}

/** One retry omp announced on `auto_retry_start` — a transient provider error
 *  (rate limit, outage, quota wall) it is replaying by itself. */
export interface ProviderRetryInfo {
  /** 1-based retry number within the run's retry budget. */
  attempt?: number;
  /** The budget (`retry.maxRetries`), absent when omp does not report one. */
  maxAttempts?: number;
  /** The wait omp takes before this attempt, in ms. */
  delayMs?: number;
  /** The provider's own message for the failed attempt. */
  errorMessage?: string;
}

/** Callbacks the timeline hands to useOmpAgent; every frame the stream folds
 *  into ChatMessageData lands on one of these. */
export interface OmpAgentCallbacks {
  onAgentStart?: () => void;
  /** A single turn inside the run began (multi-turn runs emit several). */
  onTurnStart?: () => void;
  onMessageUpdate?: (msg: ChatMessageData) => void;
  onMessageEnd?: (msg: ChatMessageData) => void;
  onAgentEnd?: (info: { errorMessage?: string; message?: string }) => void;
  onPromptError?: (errorMessage: string) => void;
  /** The dispatched prompt ran no agent turn: omp executed a built-in slash
   *  command itself (ack `agentInvoked:false`, e.g. /usage, /compact). No
   *  agent_start/agent_end follows, so the timeline must clear the optimistic
   *  generating state here or the AI placeholder spins forever. */
  onPromptSettled?: () => void;
  /** Output of a built-in slash command omp executed on the prompt path
   *  (`command_output` frame — /usage, /model, /compact result, …). Lives only
   *  on the live stream: it never enters get_state.messages or the session
   *  JSONL, so the timeline must render it from this frame or it is lost. */
  onCommandOutput?: (text: string) => void;
  /** omp changed the session's display title (auto-generation, /rename, or an
   *  RPC set_session_name). The frame is the only push signal for it — the
   *  sidebar reads titles from the session file, which the 256-byte slot write
   *  updates without changing the scan cache's mtime key — so consumers must
   *  revalidate the session list from here. */
  onSessionTitleChanged?: (title: string) => void;
  onNotice?: (level: string, message: string) => void;
  onConnected?: () => void;
  /** Mount-time probe found the session mid-run → the stream was reattached
   *  and the UI should resume its generating state. */
  onResumeStream?: () => void;
  /** Ask/approval dialog diminta omp — blocking sampai di-respond. */
  onExtensionUiRequest?: (request: IncomingExtensionUiRequest) => void;
  /** User-message turn delivered by omp (queued steer/follow-up picked up). */
  onQueuedMessageDelivered?: (text: string) => void;
  /** omp applied a model change (set_model). The frame carries no payload, so
   *  consumers should re-read session metadata to refresh the displayed model. */
  onModelChanged?: () => void;
  /** Live activity phrase for the generating indicator ("Editing app/x.ts"),
   *  derived from the tool call or assistant phase the stream is on. */
  onActivity?: (verb: string) => void;
  /** omp is replaying a transient provider error (rate limit, outage, quota
   *  wall) — `auto_retry_start`. Called once per retry SAGA (the frame's
   *  `attempt === 1`), because the run stays open across the retries and the
   *  timeline would otherwise show ten rows for one stall. */
  onProviderRetry?: (info: ProviderRetryInfo) => void;
}

export interface OmpAgentState {
  isGenerating: boolean;
  connected: boolean;
  error: string | null;
}

/**
 * An attached image payload accepted by every prompt-bearing RPC command.
 * `type` is part of omp's `ImageContent` contract and is REQUIRED: omp's
 * history encoder (`pi-ai/src/dialect/history.ts`) and its text fallback
 * (`pi-ai/src/dialect/rendering.ts`) both select blocks by `type === "image"`,
 * so a payload without it is dropped from the model's context.
 */
export interface AgentImage {
  type: 'image';
  data: string;
  mimeType: string;
}

/**
 * Outcome of one prompt dispatch attempt.
 *
 * `ok: false` with `busy: true` is the one case a caller must act on: omp
 * REFUSED the prompt because a turn is still streaming, so nothing was
 * delivered and the caller may queue the message and re-send it when the run
 * ends. Every other failure (`ok: false, busy: false`) may have been accepted
 * already — a timed-out ack, a transport error — and must never be resent
 * automatically. A bare boolean could not tell the two apart, which is how a
 * mid-turn prompt was silently dropped.
 */
export interface PromptDispatchResult {
  ok: boolean;
  /** True only when the server reported omp's typed mid-turn refusal. */
  busy: boolean;
  /** Server-supplied reason, when one was returned. */
  error?: string;
  /** The command was SENT but its outcome is unknown — omp queues a steer
   *  before it parks on a blocking dialog, so an unacknowledged steer may well
   *  be running. Reported as a warning, never as a failure: calling it one
   *  would tell the user their message was lost when it was not. */
  uncertain?: boolean;
}

/** Command surface returned by useOmpAgent — the live omp session handle the
 *  chat timeline drives. */
export interface OmpAgentHandle extends OmpAgentState {
  /** Send a prompt to an already-spawned session (warms the process up first).
   *  `accessMode` rides the warmup + prompt bodies: omp has no RPC to change its
   *  tool-approval mode, so the CLI `--approval-mode` flag is applied at spawn
   *  time and the server reconciles an idle session by respawning it. */
  sendPrompt: (message: string, images?: AgentImage[], options?: { accessMode?: ApprovalMode }) => Promise<PromptDispatchResult>;
  /** Spawn a brand-new omp session and send its first prompt; resolves with the
   *  adopted session id (or null on failure). */
  sendNewPrompt: (
    message: string,
    cwd: string,
    images?: AgentImage[],
    composerOptions?: {
      model?: { provider: string; modelId: string } | null;
      thinkingLevel?: string | null;
      accessMode?: ApprovalMode;
      /** Plan/goal picks made on a pending view. A brand-new session has no
       *  transcript to restore them from, so they ride the spawn environment. */
      modes?: { plan: boolean; goal: boolean } | null;
    },
  ) => Promise<{ sessionId: string; model: { provider: string; modelId: string } | null } | null>;
  /** Steer the running agent: deliver the message INTO the turn in flight
   *  (omp's `steer` RPC). The run continues; the model sees the message inside
   *  the same turn and answers it there.
   *
   *  This replaced `abort_and_prompt`, which CANCELS the turn and starts a new
   *  one — "Send Now (Steering)" on a queued row threw away the answer the user
   *  was watching. Measured on omp 18.8.3: `steer` produced one `agent_start`
   *  and one `agent_end` with the steer answered in the same run, while
   *  `abort_and_prompt` produced two of each.
   *
   *  Resolves with a reason instead of a bare boolean: a steer that did not go
   *  out has to SAY so. The composer is cleared before the await (the draft is
   *  restored on failure), so a silent failure looked like a delivered message.
   *
   *  Two of omp's answers are not failures of the child. A pending ask/approval
   *  dialog parks omp's command loop, so the server refuses up front
   *  (`session_blocked_on_dialog`) rather than hanging the request; a bounded
   *  ack (`rpc_command_timeout`) means the message was QUEUED but the ack was
   *  held — it still runs, so the caller must not treat it as lost. */
  steerOmpRun: (message: string, images?: AgentImage[]) => Promise<PromptDispatchResult>;
  abort: () => Promise<void>;
  setModel: (provider: string, modelId: string) => Promise<void>;
  setThinkingLevel: (level: string) => Promise<void>;
  /** Answer an ask/approval dialog, releasing omp's blocking tool call.
   *  `answers` is the grouped ask's reply: one entry per question, in order. */
  respondToExtensionUi: (
    request: ExtensionUiDialogRequest,
    response:
      | { value: string }
      | { confirmed: boolean }
      | { cancelled: true }
      | { answers: { id: string; selectedOptions: string[]; customInput?: string }[] },
  ) => Promise<void>;
  disconnect: () => void;
}

/** Frame `extension_ui_request` dari omp (ask dialog, approval, OAuth). */
export type ExtensionUiDialogMethod = 'select' | 'confirm' | 'input' | 'editor' | 'ask';

/** One question inside a grouped `ask` request (omp's `AskQuestion`). */
export interface ExtensionAskQuestion {
  id: string;
  question: string;
  options: { label: string; description?: string }[];
  header?: string;
  /** Allow several options to be selected at once. */
  multi?: boolean;
  /** Index into `options` omp marks as the recommended choice. */
  recommended?: number;
}

export interface ExtensionUiDialogRequest {
  type: 'extension_ui_request';
  id: string;
  method: ExtensionUiDialogMethod;
  title: string;
  options?: string[];
  optionDetails?: { description?: string }[];
  message?: string;
  placeholder?: string;
  prefill?: string;
  timeout?: number;
  /**
   * Mask what is typed. omp 18.14.0 added it to `ctx.ui.input({ secret: true })`
   * and forwards it on this frame; a client that ignores it draws a password as
   * plain text. Present only on `method: "input"`.
   */
  secret?: boolean;
  /**
   * Present only on the GROUPED `ask` request, which omp sends after
   * `set_ask_dialog {enabled:true}`: every question of one `ask` tool call in a
   * single frame, answered by one `answers` response instead of one `select`
   * per question. Absent on every other method.
   */
  questions?: ExtensionAskQuestion[];
}

export type IncomingExtensionUiRequest =
  | ExtensionUiDialogRequest
  | { type: 'extension_ui_request'; id: string; method: 'cancel'; targetId: string }
  | { type: 'extension_ui_request'; id: string; method: 'notify'; message: string; notifyType?: 'info' | 'warning' | 'error' }
  | { type: 'extension_ui_request'; id: string; method: 'open_url'; url: string; launchUrl?: string; instructions?: string };
