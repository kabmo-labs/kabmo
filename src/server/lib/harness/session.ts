/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The contract every transport-backed session satisfies.
 *
 * `AgentSessionWrapper` (omp RPC) already had this shape; naming it lets the
 * registry hold an ACP session and an omp session in ONE map, which is what the
 * realtime topic, the sidebar, the queue and every route already read from.
 *
 * Deliberately narrow: only what a CALLER outside the driver uses. An omp-only
 * member (`runSettle`, `subagents`, `modeMirror`) is not here because a
 * harness without it must not pretend — the capability table says which
 * surfaces exist.
 */

import type { AgentEvent } from '@/server/lib/omp/rpc/constants';
import type { HarnessId } from '@/shared/lib/harness/catalog';

export interface HarnessEventSource {
  onEvent(listener: (event: AgentEvent) => void): () => void;
  emit(event: AgentEvent): void;
}

/** What a session answers about itself without asking the agent. */
export interface HarnessSessionState {
  /** The agent's own session id (omp: `get_state.sessionId`). */
  readonly sessionId: string;
  /** On-disk transcript, when the harness has one Kabmo can read. Empty for
   *  ACP sessions, whose history lives behind `session/load`. */
  readonly sessionFile: string;
  readonly cwd: string;
  /** Which harness owns this session — the field every panel gates on. */
  readonly harness: HarnessId;
  readonly isStreaming: boolean;
  readonly isPromptRunning: boolean;
  /** The model serving the run, as the agent resolved it. */
  readonly runModel: { provider: string; modelId: string } | null;
}

/** A live session: state, a control channel, and a frame stream. */
export interface HarnessSession extends HarnessEventSource, HarnessSessionState {
  isAlive(): boolean;
  isRunning(): boolean;
  /** Anything a forced reset would destroy (a turn, a dialog, a subagent). */
  isBusy(): boolean;
  send(command: Record<string, unknown>): Promise<unknown>;
  /** Blocking dialogs a reattaching client must replay. */
  getPendingUiDialogs(): Record<string, unknown>[];
  resolvePendingUiDialog(id: string): void;
  destroy(): void;
  destroyAndWait(): Promise<void>;
  /** Delete the harness's own session record, when the agent advertises one
   *  (`sessionCapabilities.delete`). Best-effort: the local rows are the caller's. */
  deleteAgentSession?(): Promise<void>;
  onDestroy(callback: () => void): void;
}

/** Spawn parameters shared by every driver. */
export interface HarnessSpawnRequest {
  /** The id Kabmo asked for (a placeholder for a brand-new chat). */
  sessionId: string;
  /** On-disk transcript to resume, or '' for a new session. */
  sessionFile: string;
  cwd: string;
  /** Extra environment (mode selection, approval mode). */
  env?: Record<string, string>;
}

/** A driver maps one harness onto `HarnessSession`s. */
export interface HarnessDriver {
  readonly id: HarnessId;
  /** Spawn (or resume) one session. */
  open(request: HarnessSpawnRequest): Promise<{ session: HarnessSession; realSessionId: string }>;
}
