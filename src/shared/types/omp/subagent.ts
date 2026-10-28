/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Subagent wire types — mirrors of oh-my-pi task/types.ts (AgentProgress /
 * SubagentLifecyclePayload / RpcSubagentSnapshot / SubagentMessagesPage).
 *
 * Every field is optional where the wire may omit it: payloads are parsed
 * leniently (see `@/lib/omp/subagent/parse`) and malformed frames must never
 * fabricate live roster entries.
 */

/** Where an agent definition came from. */
export type SubagentAgentSource = 'bundled' | 'user' | 'project';

export interface SubagentRetryState {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  errorMessage: string;
  startedAtMs: number;
}

/** Live per-subagent progress snapshot (oh-my-pi AgentProgress). */
export interface SubagentProgress {
  index?: number;
  id?: string;
  agent?: string;
  agentSource?: SubagentAgentSource;
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'aborted';
  task?: string;
  assignment?: string;
  description?: string;
  lastIntent?: string;
  currentTool?: string;
  currentToolArgs?: string;
  currentToolStartMs?: number;
  recentTools?: Array<{ tool: string; args: string; endMs: number }>;
  recentOutput?: string[];
  toolCount?: number;
  requests?: number;
  tokens?: number;
  contextTokens?: number;
  contextWindow?: number;
  cost?: number;
  durationMs?: number;
  modelOverride?: string | string[];
  modelRole?: string;
  resolvedModel?: string;
  /**
   * Thinking level the child's own model resolved to. Never inferred from the
   * parent session: the child may run at a different level than the chat that
   * spawned it, so the footer must read this one or show nothing.
   */
  resolvedThinkingLevel?: string;
  resolvedModelIsFallback?: boolean;
  retryState?: SubagentRetryState;
  retryFailure?: { attempt: number; errorMessage: string };
  inflightTaskDetails?: unknown;
  extractedToolData?: Record<string, unknown[]>;
}

/** Compact live-activity entry derived from subagent_event frames. */
export interface SubagentActivityEvent {
  kind: 'tool' | 'text' | 'notice';
  label: string;
  ts: number;
}

/** Settled per-subagent result from a parent task toolResult (SingleResult). */
export interface SubagentHistoryResult {
  exitCode?: number;
  truncated?: boolean;
  cost?: number;
  structuredOutput?: { source?: string; mode?: string; status?: string; error?: string };
  error?: string;
  aborted?: boolean;
  abortReason?: string;
  outputPath?: string;
  patchPath?: string;
  branchName?: string;
}

/** On-disk subagent history recovered from a parent session's task toolResults. */
export interface SubagentHistoryEntry {
  id: string;
  agent: string;
  agentSource?: SubagentAgentSource;
  status: 'started' | 'completed' | 'failed' | 'aborted';
  task?: string;
  assignment?: string;
  description?: string;
  index: number;
  /** Id of the `task` call that spawned this agent, and that call's position in
   * the session's sequence of `task` calls. Together with `index` they place the
   * agent without relying on the order entries happen to arrive in. */
  parentToolCallId?: string;
  batchSeq?: number;
  sessionFile?: string;
  transcriptAvailable: boolean;
  /** True when the spawn was detached/async (parent turn kept working). */
  detached?: boolean;
  lastIntent?: string;
  toolCount?: number;
  requests?: number;
  tokens?: number;
  contextTokens?: number;
  contextWindow?: number;
  cost?: number;
  durationMs?: number;
  modelOverride?: string | string[];
  modelRole?: string;
  resolvedModel?: string;
  resolvedModelIsFallback?: boolean;
  retryFailure?: { attempt: number; errorMessage: string };
  result?: SubagentHistoryResult;
}

/** get_subagents snapshot (RpcSubagentSnapshot) as seen over the wire. */
export interface SubagentSnapshotLike {
  id: string;
  index: number;
  agent: string;
  agentSource?: SubagentAgentSource;
  description?: string;
  status: 'started' | 'completed' | 'failed' | 'aborted' | 'pending' | 'running';
  task?: string;
  assignment?: string;
  sessionFile?: string;
  lastUpdate?: number;
  progress?: unknown;
  parentToolCallId?: string;
}

/**
 * One roster row shared by live frames and on-disk history.
 * Lives under app/types (not in the hook) so server-side helpers and the UI
 * import the exact same shape.
 */
export interface SubagentInfo {
  id: string;
  agent: string;
  agentSource?: SubagentAgentSource;
  description?: string;
  status: 'started' | 'completed' | 'failed' | 'aborted';
  task?: string;
  assignment?: string;
  sessionFile?: string;
  parentToolCallId?: string;
  /** Position inside the spawning `task` call's batch. Restarts at 0 for every
   * call, so it orders siblings but never the roster — pair it with `batchSeq`.
   * Also the matching key for id-less progress frames. */
  index: number;
  detached?: boolean;
  progress?: SubagentProgress;
  lastUpdate?: number;
  /** Model role the run resolved to. On-disk history entries carry it here
   *  (folded from the parent's task toolResult); live snapshots carry it on
   *  `progress` instead, because it arrives with the progress frame. */
  modelRole?: string;
  /** Settled result for history entries (SingleResult-derived). */
  result?: SubagentHistoryResult;
  /** Roster origin: live frames/snapshots (default) vs on-disk history. */
  source?: 'live' | 'history';
  /** Ordinal of the `task` call that spawned this agent, as recorded in the
   * session file. Authoritative launch order, but only available once that
   * call's result is on disk. */
  batchSeq?: number;
}

/** get_subagent_messages response page (rpc-ui wire shape). */
export interface SubagentMessagesPage {
  /** Session file the messages were read from. */
  sessionFile: string;
  /** Byte offset this page starts at (0 = head of the transcript). */
  fromByte: number;
  /** Byte offset to pass as the next fromByte for continuation. */
  nextByte: number;
  /** True when the transcript shrank (retruncated) and paging must restart. */
  reset?: boolean;
  /** Raw omp messages — convert via `@/lib/omp/session/mapper` toChatMessage. */
  messages: unknown[];
  totalBytes?: number;
}
