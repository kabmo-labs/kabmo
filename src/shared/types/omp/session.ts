/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Domain types for the oh-my-pi discovery layer (`@/lib/omp`).
 *
 * These mirror the shapes omp-web uses for its sidebar (ManagedProject /
 * SessionInfo) so a future UI fork can consume them directly. They are
 * intentionally independent from the existing SQLite-backed types
 * (`WorkspaceFolderData` / `SessionItemData`).
 */

/** A workspace (project root) shown in the sidebar list. */
export interface OmpProject {
  /** Canonical absolute path of the project root. */
  path: string;
  /** ISO timestamp of the most recent explicit add (registered only). */
  addedAt?: string;
  /** Optional display-only workspace name (registered only). */
  alias?: string;
  /** Explicit sidebar position; lower values appear first (registered only). */
  sortOrder?: number;
  /** True when this project was discovered from session files on disk rather
   *  than registered in ~/.omp/agent/projects.json. */
  discovered: boolean;
}

/**
 * Per-message token/cost usage as omp records it in a session JSONL
 * (`message.usage`). The canonical shape shared by the telemetry, stats, and
 * usage-aggregation readers — every field is optional because legacy entries
 * omit subsets of them.
 */
export interface OmpUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  /** Anchored prompt occupancy reported by the provider (never a per-turn total). */
  contextTokens?: number;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number };
}

/** Anchored context snapshot omp attaches to a message (telemetry only). */
export interface OmpContextSnapshot {
  promptTokens?: number;
  /** Estimated prompt tokens removed by local history rewrites after the snapshot. */
  historyRewriteTokensRemoved?: number;
  nonMessageTokens?: number;
  compactionEpoch?: number;
}

/**
 * The `message` payload of a `type:"message"` JSONL entry. Superset of every
 * reader's view (chat reload, telemetry, stats, usage aggregation): the chat
 * path reads tool/error fields, telemetry reads usage/contextSnapshot, and the
 * open index signature tolerates fields a future omp version adds.
 */
export interface OmpMessage {
  role?: string;
  content?: unknown;
  model?: string;
  provider?: string;
  usage?: OmpUsage;
  contextSnapshot?: OmpContextSnapshot;
  stopReason?: string;
  isError?: boolean;
  /** Chat-reload: pairs a toolResult with its toolCall. */
  toolCallId?: string;
  toolName?: string;
  details?: unknown;
  attribution?: unknown;
  /** Wall-clock start (epoch ms) or ISO string, per omp version. */
  timestamp?: string | number;
  completedAt?: string | number;
  duration?: number;
  /** Provider error fields recorded flat on an abnormal turn. */
  errorStatus?: number;
  errorId?: number;
  errorMessage?: string;
  [key: string]: unknown;
}

/**
 * One raw omp session JSONL record. This is the single canonical entry type
 * shared by the chat reload path, telemetry, stats, and usage aggregation —
 * each reader reads the optional fields it needs (title/compaction markers,
 * model/thinking changes, message payloads).
 */
export interface OmpMessageEntry {
  type?: string;
  customType?: string;
  id?: string;
  parentId?: string | null;
  timestamp?: string;
  cwd?: string;
  title?: string;
  shortSummary?: string;
  /** Session-level model recorded by a `model_change` entry. */
  model?: string;
  /** Session-level thinking level recorded by a `thinking_level_change` entry. */
  thinkingLevel?: string;
  content?: unknown;
  details?: unknown;
  /** Turn-level metadata omp may place beside the message rather than inside it. */
  attribution?: unknown;
  durationMs?: unknown;
  message?: OmpMessage;
}

/** Fields every session summary shares, whether it comes from a 4 KiB scan or
 *  the sidebar wire payload. */
export interface OmpSessionBase {
  /** Absolute path of the session .jsonl file. */
  path: string;
  id: string;
  /** Working directory the session ran in. */
  cwd: string;
  /** Prefix-derived lower bound of the message count. */
  messageCount: number;
  /** First user message text (truncated by the prefix window). */
  firstMessage: string;
}

/** A session summary — one sidebar row under a project. */
export interface OmpSession extends OmpSessionBase {
  /** Display title (title-slot wins; falls back to header title). */
  name?: string;
  /** ISO timestamp of session creation (header timestamp). */
  created: string;
  /** ISO timestamp of the session's last entry — the newest JSONL record's own
   *  `timestamp`. Drives "latest session" ordering and the row's relative age;
   *  the file mtime is deliberately not used (a title-slot rewrite bumps it
   *  without a turn having happened). */
  modified: string;
  /** Parent session id when this session was forked/branched. */
  parentSessionId?: string;
  /** Resolved root of the repository the session's cwd belongs to. */
  projectRoot?: string;
}

/** Full sidebar payload — equivalent to omp-web's /api/projects + /api/sessions. */
export interface OmpSidebarData {
  projects: OmpProject[];
  sessions: OmpSession[];
  /** Path of the agent dir the data was read from (~/.omp/agent). */
  agentDir: string;
  /** True when the sessions root exists and was readable. */
  available: boolean;
  /** ISO timestamp of the read (client can use it as a refresh cursor). */
  generatedAt: string;
}
