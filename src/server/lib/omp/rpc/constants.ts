/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Shared types, constants and pure helpers for the omp session RPC manager.
 * Kept separate from the session wrapper/registry so each file stays under the
 * repo's per-file size ceiling.
 */

import { homedir } from 'os';
import { pathExists } from '@/server/lib/omp/core/paths';
import { kabmoExtensionArgs } from '@/server/lib/omp/extensions/locator';
import { ensureTitleModelOverlay, titleModelOverlayPath } from '@/server/lib/omp/session/title-model-overlay.server';
import type { ApprovalMode } from '@/shared/lib/omp/config/access-mode';
import type { SelectedModel } from '@/shared/types/models';

export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

export type EventListener = (event: AgentEvent) => void;

export interface RpcSessionState {
  sessionId: string;
  sessionFile?: string;
  sessionName?: string;
  isStreaming: boolean;
  /** omp's own quiescence verdict: no live, admitted or scheduled turn, nothing
   *  queued, and no background work that could wake the session again. Absent on
   *  builds that do not report it — read as "not settled". */
  isSettled?: boolean;
  isCompacting: boolean;
  autoCompactionEnabled: boolean;
  autoRetryEnabled?: boolean;
  interruptMode: 'immediate' | 'wait';
  steeringMode: 'all' | 'one-at-a-time';
  followUpMode: 'all' | 'one-at-a-time';
  model?: { id: string; provider: string; name?: string; reasoning?: boolean; thinking?: { efforts?: string[] } };
  messageCount: number;
  queuedMessageCount: number;
  contextUsage?: { tokens: number; contextWindow: number; percent: number } | null;
  systemPrompt?: string[];
  thinkingLevel?: string;
  fastMode?: boolean;
  fastModeEnabled?: boolean;
  fastModeActive?: boolean;
  tokensPerSecond?: number | null;
  todoPhases?: unknown[];
}

export interface WebSessionState {
  sessionId: string;
  sessionFile: string;
  sessionName?: string;
  isStreaming: boolean;
  isPromptRunning: boolean;
  isBashRunning: boolean;
  isCompacting: boolean;
  autoCompactionEnabled: boolean;
  autoRetryEnabled?: boolean;
  interruptMode: 'immediate' | 'wait';
  steeringMode: 'all' | 'one-at-a-time';
  followUpMode: 'all' | 'one-at-a-time';
  model?: { id: string; provider: string; name?: string; reasoning?: boolean; thinking?: { efforts?: string[] } };
  messageCount: number;
  queuedMessageCount: number;
  contextUsage: { tokens: number; contextWindow: number; percent: number } | null;
  systemPrompt: string;
  thinkingLevel: string;
  fastModeEnabled: boolean;
  fastModeActive?: boolean;
  tokensPerSecond: number | null;
  todoPhases: unknown[];
}

/** Quiet window before an unused child is reclaimed. Long enough that a session
 *  a user is reading does not pay a respawn, short enough that a forgotten one
 *  does not hold a process. */
export const IDLE_REAP_MS = 10 * 60 * 1000;
// Longest a subagent may go without a frame before the wrapper stops counting
// it as live work. A terminal frame lost to a protocol hiccup would otherwise
// pin the session's omp process (and its whole process group) open forever; the
// price of the window is at most one idle omp process.
export const SUBAGENT_STALE_MS = 30 * 60 * 1000;
export const READY_TIMEOUT_MS = 120_000;
export const GET_STATE_TIMEOUT_MS = 5_000;
export const PROMPT_ACK_TIMEOUT_MS = 30_000;
// A `/reload-plugins` re-read of the skill/command roots. omp answers it in
// ~16-40 ms even mid-turn (measured on 18.4.3), so a short cap only bounds a
// child that stopped answering at all — the caller's retry is the recovery.
export const RELOAD_PLUGINS_TIMEOUT_MS = 10_000;
export const NON_TERMINAL_CONTINUATION_GRACE_MS = 2_000;
export const AWAITING_AGENT_START_TIMEOUT_MS = 10_000;
// A `steer`/`follow_up`/`abort_and_prompt` ack. omp answers one in ~2 ms while
// the turn streams, so this only bounds a child that stopped answering. It is
// deliberately NOT routed through `settleCommandTimeout`: omp QUEUES the steer
// before it acks (measured — a blocked child answered 3 ms after its dialog was
// dismissed and then ran the steer), so a late ack is not proof the message was
// lost, and destroying the child would discard it.
export const STEER_ACK_TIMEOUT_MS = 15_000;
export const RESTARTING_MESSAGE = 'This session is restarting — retry in a moment.';
// A pending ask/approval dialog blocks omp's whole command loop: `abort` and
// `abort_and_prompt` never ack while one is up (measured against omp 18.7.0 —
// both timed out at 15-20 s with a `select` dialog pending, and the steer ran
// the moment the dialog was answered). Refusing up front turns a hang into an
// instruction the user can act on.
export const SESSION_BLOCKED_ON_DIALOG_MESSAGE =
  'This session is waiting on an approval dialog — answer or dismiss it first.';
// A command timeout is not proof an omp child is wedged: omp runs RPC handlers
// one at a time, so a slow `get_state`/`prompt` ack can simply be queued behind
// the running turn. That session keeps its process — only a session that is
// idle AND unresponsive is reset.
export const SESSION_BUSY_MESSAGE = 'The OMP session is busy with the running turn; retry once it settles.';

/**
 * omp's typed refusal for a PLAIN prompt dispatched while a turn streams.
 *
 * `session.prompt()` with no `streamingBehavior` throws `AgentBusyError` when
 * the session is streaming (measured on omp 18.6.1), and the RPC layer answers
 * it as a FAILED `prompt` response carrying {@link AGENT_BUSY_REFUSAL_RE}'s
 * phrase. Nothing was delivered, so the caller may safely queue the message and
 * re-send it when the run ends.
 *
 * This is a DIFFERENT condition from {@link SESSION_BUSY_MESSAGE}, which the
 * timeout path raises for a prompt whose ack was merely queued behind a running
 * turn — that one may already have been accepted, so it must never be resent
 * automatically. The two are deliberately separate codes.
 */
export const AGENT_BUSY_MESSAGE = 'The agent is still working on the previous turn; the message was not sent.';
export const AGENT_BUSY_REFUSAL_RE = /already processing/i;

export class WebRpcError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'WebRpcError';
    this.code = code;
  }
}

// Commands forwarded to omp verbatim (request shape already matches rpc-types).
export const PASSTHROUGH_COMMANDS = new Set([
  'abort',
  'abort_and_prompt',
  // steer: interrupt/redirect the running agent; follow_up: enqueue a message the agent handles after the current turn.
  'steer',
  'follow_up',
  'set_thinking_level',
  'cycle_thinking_level',
  'cycle_model',
  'get_available_models',
  'set_auto_compaction',
  'set_auto_retry',
  'abort_retry',
  'abort_bash',
  'set_todos',
  'set_steering_mode',
  'set_follow_up_mode',
  'set_interrupt_mode',
  'get_messages',
  'get_messages_page',
  'get_subagents',
  'get_subagent_messages',
  'cancel_subagent',
  'steer_subagent',
  'set_subagent_subscription',
  'get_login_providers',
  'login',
]);

// Commands that only READ live process state, with an RPC-free on-disk
// equivalent. A live session answers them on the fast path; for one Kabmo
// does not manage, the spawn path must refuse them (409) rather than boot an
// omp child to answer a read. The sidebar renders a roster row for every
// session in the list, so an unconditional probe started a process per finished
// session merely looked at (measured: the omp process count grew on a session
// whose liveness probe had just reported `running: false`).
export const OBSERVER_ONLY_COMMANDS = new Set(['get_subagents', 'get_subagent_messages']);

/**
 * Commands that control a run IN THIS PROCESS — they name no work, only the
 * stopping of work already under way. A live session answers them on the fast
 * path; with no wrapper here the spawn path must refuse them (409) instead of
 * booting a child to answer "stop".
 *
 * Spawning is not merely wasteful, it is destructive: the spawn path resumes
 * the session FILE, and a `stream` row is written by whichever process owns the
 * run — so an `abort` posted from a second Kabmo instances (or from a page
 * that reattached after a reload) would start a second `omp --resume` writer on
 * a session file the owning process is appending to, abort nothing, and, for
 * `force_reset`, then destroy the child it had just created. The Stop button
 * now follows the server-tracked `stream` status, so a press is sent exactly
 * while the sidebar says a run is in flight — which is also the only time the
 * owning process would answer it.
 */
export const LIVE_RUN_COMMANDS: Record<string, true> = {
  abort: true,
  force_reset: true,
};

/**
 * Commands that MOVE the conversation: they replace the transcript the session
 * is running on, so a side question that snapshotted the old one would be left
 * describing a conversation the chat has already left. omp blocks the same
 * operations while a `/btw` answer is in flight or unsaved
 * (`BtwController.withSessionMove` / `flush`); Kabmo refuses them with
 * `btw_busy` (409) instead.
 */
export const CONVERSATION_MOVING_COMMANDS = new Set(['switch_session', 'branch', 'new_session', 'handoff']);

// Commands that can carry user-attached images to the model. All of them must
// pass the same server-side per-image/count/aggregate validation before the
// payload reaches omp — a client is free to POST any of them directly.
export const IMAGE_BEARING_COMMANDS = new Set(['prompt', 'steer', 'follow_up', 'abort_and_prompt']);

// `extension_ui_request` methods that BLOCK the agent until the matching
// `extension_ui_response` arrives. omp emits no re-delivery, so the server is
// the only place a still-pending request can be remembered across a client
// reload. The list is SHARED with the client's dialog queue
// (`@/shared/lib/omp/dialog-methods`) because the two must agree — a method
// missing from one side is a dialog one half remembers and the other drops,
// which is how a grouped `ask` frame went unanswerable on both.
export { ANSWERABLE_UI_METHODS } from '@/shared/lib/omp/dialog-methods';

export const MAX_ATTACHED_IMAGES = 20;
export const MAX_ATTACHED_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_AGGREGATE_IMAGE_BYTES = 40 * 1024 * 1024;

export function validateAgentImages(images: unknown): string | null {
  if (images === undefined) return null;
  if (!Array.isArray(images)) return 'images must be an array';
  if (images.length > MAX_ATTACHED_IMAGES) return `Maximum of ${MAX_ATTACHED_IMAGES} attached images reached.`;
  let aggregate = 0;
  for (const image of images) {
    if (!image || typeof image !== 'object') return 'invalid image entry';
    const data = (image as { data?: unknown }).data;
    const mimeType = (image as { mimeType?: unknown }).mimeType;
    if (typeof data !== 'string' || typeof mimeType !== 'string') return 'invalid image entry';
    const bytes = Buffer.byteLength(data, 'base64');
    if (bytes > MAX_ATTACHED_IMAGE_BYTES) return `Images up to ${Math.round(MAX_ATTACHED_IMAGE_BYTES / 1024 / 1024)} MB are supported.`;
    aggregate += bytes;
  }
  if (aggregate > MAX_AGGREGATE_IMAGE_BYTES) return 'Total image size exceeds the supported limit.';
  return null;
}

export function toImageContents(value: unknown): Array<{ type: 'image'; data: string; mimeType: string }> | undefined {
  const images = value as Array<{ type: 'image'; data: string; mimeType: string }> | undefined;
  return images?.length ? images : undefined;
}

/** Pick a spawn cwd that actually exists. A session records the directory it
 * was created in, but that directory may have been deleted since: spawn()
 * would fail with ENOENT and `omp --cwd <missing>` throws in setProjectDir. */
export async function resolveSpawnCwd(recordedCwd?: string | null): Promise<string> {
  if (recordedCwd && (await pathExists(recordedCwd))) return recordedCwd;
  try {
    const serverCwd = process.cwd();
    if (serverCwd && (await pathExists(serverCwd))) return serverCwd;
  } catch {
    // process.cwd() itself throws when the server's own cwd was removed.
  }
  return homedir();
}

/** Extra CLI args for spawning `omp --mode rpc-ui` for a session.
 *
 *  `-e <extensions/kabmo-modes/index.ts>` is always appended when the file is
 *  present: Kabmo's plan/goal toggles are driven from inside the child
 *  (omp has no RPC verb for either mode), so the extension is not optional
 *  equipment for a session that happens to have a mode on — it is how the
 *  composer's controls reach the agent at all.
 *
 *  `--config <overlay>` points the child at Kabmo's title-model overlay,
 *  which exists (empty) before this runs. It is how a session's own model
 *  reaches omp's title generation: the child watches that path, so
 *  `rename-with-ai` rewrites the `tiny` role for the duration of one request.
 *  See `session/title-model-overlay.server.ts`. */
export function buildSessionSpawnArgs(
  sessionFile: string,
  approvalMode?: ApprovalMode,
  resumeModel?: SelectedModel,
): string[] {
  const args: string[] = [];
  ensureTitleModelOverlay();
  args.push('--config', titleModelOverlayPath());
  if (sessionFile) {
    // An absolute path resolves deterministically: omp's createSessionManager
    // opens it directly via SessionManager.open without any interactive
    // resume/fork prompts.
    args.push('--resume', sessionFile);
  }
  // The model the session is RESTORED with. omp restores the model its
  // transcript's last `model_change` names, and it does NOT fall back when
  // that model is no longer in the registry: the child exits(1) with
  // "Could not restore model <provider>/<id>" and every command to the
  // session fails with it. `--model` names a model that DOES resolve, so a
  // session whose recorded model is gone still starts.
  if (resumeModel?.provider && resumeModel.modelId) {
    args.push('--model', `${resumeModel.provider}/${resumeModel.modelId}`);
  }
  if (approvalMode) {
    // Spawn-time only: omp exposes no RPC command to change the tool-approval
    // mode, so the flag is the sole lever. It works with or without --resume.
    args.push('--approval-mode', approvalMode);
  }
  args.push(...kabmoExtensionArgs());
  return args;
}
