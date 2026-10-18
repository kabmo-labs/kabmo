import type { ReactNode } from 'preact/compat';
import type { ApprovalMode } from '@/shared/lib/omp/config/access-mode';

/** One image a tool result returned (a `read` of a picture, an `eval` that
 *  painted one). Exactly one payload field is set: omp externalizes anything
 *  large to the blob store and inlines the rest. */
export interface ToolImageRef {
  mimeType: string;
  /** `blob:sha256:<hash>` when omp externalized the bytes to the blob store. */
  blobRef?: string;
  /** Inline base64 payload (a small image, or a session written before the
   *  externalization threshold existed). */
  dataBase64?: string;
}

export interface Attachment {
  id: string;
  /**
   * Display name. Written at creation so a replayed attachment — one that has
   * been through the queue's JSON round trip or back out of committed history —
   * still renders and still inlines.
   */
  name?: string;
  /**
   * Live file handle. ABSENT on every replayed attachment: `File` is not
   * serializable (`JSON.stringify(new File(...))` is `{}`), so the queue row and
   * the committed message keep only the display fields below. Read the fields
   * through `@/shared/lib/chat/attachments` accessors — `a.file.name` throws
   * here, which is what used to break queue delivery and retry.
   */
  file?: File;
  preview: string;
  type?: string;
  size?: number;
  /** Base64 payload for image attachments (sent to the omp model). */
  dataBase64?: string;
  /** Inlined text-file contents, persisted with the committed user turn so a
   *  retry can re-send them without the original `File`. */
  content?: string;
  /**
   * Set when `content` came from sniffing the file's bytes rather than from its
   * name or MIME. A promised-file drag from another app has neither, so without
   * this marker the send path would classify it as binary and drop it again.
   */
  sniffedText?: boolean;
}

export type ChatAttachment = Attachment;

/** Nama tool omp asli (built-in + hidden + MCP). `string` menampung tool
 *  custom/plugin dan MCP (`mcp__<server>_<tool>`). */
export type ToolType =
  | 'bash'
  | 'terminal'
  | 'read'
  | 'edit'
  | 'write'
  | 'ast_grep'
  | 'ast_edit'
  | 'ask'
  | 'debug'
  | 'eval'
  | 'github'
  | 'glob'
  | 'grep'
  | 'lsp'
  | 'checkpoint'
  | 'rewind'
  | 'context_notes'
  | 'new_context'
  | 'security_scan'
  | 'task'
  | 'hub'
  | 'todo'
  | 'web_search'
  | 'memory_edit'
  | 'retain'
  | 'recall'
  | 'reflect'
  | 'learn'
  | 'manage_skill'
  | 'yield'
  | 'goal'
  | 'think'
  | 'edit_file' // legacy alias (MOCK path)
  | 'read_file' // legacy alias (MOCK path)
  | 'view_file' // legacy alias (MOCK path)
  | 'create_file' // legacy alias (MOCK path)
  | 'search_fs' // legacy alias (MOCK path)
  | 'custom'
  | (string & {});

export type ToolStatus = 'pending' | 'running' | 'success' | 'error' | 'aborted' | 'skipped';

export interface ToolDiffChunk {
  file: string;
  added?: number;
  removed?: number;
  diffText?: string;
}

export interface ToolCallData {
  /** toolCallId dari omp — kunci pairing dengan toolResult. */
  id: string;
  type: ToolType;
  title: string;
  name?: string;
  /** Short human intent (omp arguments.i) — ditampilkan sebelum tools. */
  intent?: string;
  target?: string;
  command?: string;
  /** Raw arguments tool call (object dari omp, string dari MOCK path). */
  input?: string | Record<string, any>;
  output?: string;
  error?: string;
  status?: ToolStatus;
  duration?: string;
  /** Raw duration ms dari toolResult (untuk format ulang). */
  durationMs?: number;
  /** When the call STARTED. The only clock a still-running call has: omp
   *  reports no elapsed time on the start frame, and a watched job's
   *  `durationMs` is the JOB's age, which routinely predates the call. */
  startedAt?: number;
  diff?: ToolDiffChunk;
  /** RAW details toolResult — dipakai renderer diff/task/usage. */
  details?: Record<string, any>;
  /** Pictures the result itself returned (a `read` of an image, an `eval`
   *  that painted one). Carries the bytes or a blob reference, so the panel
   *  paints the result instead of re-reading the path it names. */
  images?: ToolImageRef[];
  isError?: boolean;
  /** details.__synthetic === true → call emitted tapi tidak dieksekusi. */
  synthetic?: boolean;
  icon?: ReactNode;
  detail?: string;
  time?: string;
}

export interface ThinkingData {
  duration?: string;
  thought: string;
  summary?: string;
  steps?: string[];
  isGenerating?: boolean;
}

export interface AgentActionData {
  icon?: ReactNode;
  title: string;
  time?: string;
  detail: string;
  type?: ToolType;
  command?: string;
  output?: string;
  status?: ToolStatus;
}

export interface ChatMessageData {
  id: string;
  role: 'user' | 'ai' | 'assistant';
  date?: string;
  timestamp?: string;
  content: string;
  attachments?: { id?: string; name: string; preview?: string; type?: string; size?: number }[];
  thinking?: ThinkingData | string;
  /** Short human intent for tool calls (omp arguments.i) shown before the tools. */
  intent?: string;
  /** System notice surfaced by omp (e.g. ultrathink-notice) — rendered as an
   *  alert row, not as assistant content. A row that ALSO carries the turn's
   *  own metadata (model/provider/usage/…) is an assistant answer omp diverted
   *  into this field and renders as text — see chat/notice-row.ts. */
  notice?: string;
  /**
   * The `customType` of the entry a `notice` row came from (`goal-start`,
   * `goal-continuation`, `ultrathink-notice`, …), when there is one. The text
   * alone cannot say which notice this is: a goal's opening turn carries the
   * bare objective, which is indistinguishable from any other prose — so the
   * renderer that draws a specific card for one kind reads it from here.
   */
  noticeSource?: string;
  toolCalls?: ToolCallData[];
  actions?: (AgentActionData | ToolCallData)[];
  systemNote?: string;
  actions2?: (AgentActionData | ToolCallData)[];
  attribution?: 'user' | 'agent' | string;
  model?: string;
  /** Provider that served this turn (omp `message.provider`). */
  provider?: string;
  /** Thinking level in effect for this turn (omp `thinking_level_change`).
   *  Null/unset records normalize to `off`; absent = no level recorded. */
  thinkingLevel?: string;
  /** Wall-clock start of the turn in epoch ms (omp `message.timestamp`). */
  startedAt?: number;
  /** Wall-clock end of the turn in epoch ms (omp `message.completedAt`), or
   *  derived from `startedAt + durationMs` when the runtime omits it. */
  completedAt?: number;
  durationMs?: number;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    totalTokens?: number;
    reasoningTokens?: number;
    cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number };
  };
  summary?: string;
  monologue?: string;
  /** Provider/API error attached to an assistant turn (e.g. 401 auth failure). */
  error?: {
    status?: number;
    id?: number;
    message?: string;
    stopReason?: string;
  };
}

/** One user turn of a session's FULL history, as listed by
 *  `GET /api/chat/:sessionId/turns`. The timeline jump rail draws one tick per
 *  entry and pages the timeline to it, so an entry carries the row id the
 *  timeline renders (the jump target) and the row's position in the full
 *  message list (`index`, the cursor the older-window loader pages from). */
export interface UserTurnRef {
  id: string;
  /** 0-based position in the session's full message list. `-1` for a row that
   *  exists only in the live timeline (an optimistic send the committed
   *  history does not carry yet) — such a row is always mounted. */
  index: number;
  /** Truncated prompt text for the rail tooltip. */
  preview: string;
  date?: string;
  timestamp?: string;
}

/** Model settings snapshotted with a queued message so auto-delivery replays
 *  them (set_model / set_thinking_level RPC + spawn access mode) instead of
 *  using whatever the session happens to run with at delivery time. */
export interface QueuedMessageModel {
  provider: string;
  modelId: string;
  /** 'auto' means "leave omp's current level untouched" at delivery. */
  thinkingLevel: string;
  accessMode: ApprovalMode;
}

/** One row of the follow-up/steering queue (SQLite `queued_messages`). */
export interface QueuedMessage {
  id: string;
  text: string;
  attachments: Attachment[];
  /** Null when queued before any model was selected — delivery falls back to
   *  the session's current model. */
  model: QueuedMessageModel | null;
}

// ── Composer autocomplete (@file/agent / /command+skill) ───────────────────

/** Trigger group that opened the composer autocomplete: `@` → mention, `/` → command. */
export type ComposerPickKind = 'mention' | 'command';
/** Origin of a pickable item: an `@` mention is an agent or a workspace file. */
export type ComposerPickSource = 'agent' | 'file' | 'command' | 'skill';

/**
 * Which part of a slash invocation the popup is completing. oh-my-pi splits
 * these the same way: `name` completes the command token itself, `args`
 * completes a declarative subcommand after `<command> `.
 */
export type ComposerTriggerPhase = 'name' | 'args';

/** A detected trigger: the `@`/`/` char plus the query typed after it. */
export interface ComposerTrigger {
  kind: ComposerPickKind;
  query: string;
  /** Index of the trigger char (`@` or `/`). */
  start: number;
  /** Caret index when detected. */
  end: number;
  /** Command completion phase; `mention` triggers are always `name`. */
  phase: ComposerTriggerPhase;
  /** Index the accepted text replaces from — equals `start` in the `name` phase. */
  replaceFrom: number;
  /** Command the `args` phase belongs to (name or alias as typed). */
  command?: string;
  /**
   * The `/token` sits mid-prompt (prose precedes it on the line or an earlier
   * line exists), so only skill entries may surface — oh-my-pi's
   * `buildMidPromptSkillCompletions` gate.
   */
  midPrompt?: boolean;
}

/** One autocomplete item surfaced in the composer popover. */
export interface ComposerPickItem {
  id: string;
  name: string;
  description: string;
  /** The item's own category (agent / file / command / skill). */
  kind: ComposerPickSource;
  source: ComposerPickSource;
  /** Exact insertion text WITHOUT trailing space: `@architect` | `@file:path/to/file` | `/review` | `/skill:capacity`. */
  token: string;
  /** Workspace-relative path (file items only). */
  path?: string;
  /**
   * Suppress the trailing space on insertion. Set on the collapsed `/skill:`
   * namespace row so the popup reopens with the individual skills, matching
   * oh-my-pi's accept path.
   */
  insertWithoutSpace?: boolean;
  /** Command aliases from oh-my-pi (`/models` for `/model`). */
  aliases?: string[];
  /** Declarative subcommands; drives the `args` phase. */
  subcommands?: ComposerSubcommand[];
  /** Argument hint (`[on|off|status]`), prefixed to the description like omp. */
  inputHint?: string;
}

/** One declarative subcommand of an oh-my-pi slash command. */
export interface ComposerSubcommand {
  name: string;
  description?: string;
  usage?: string;
}

/** A pick item after filtering, with the matched range within `name` (or null). */
export interface ComposerMatchItem extends ComposerPickItem {
  /** Matched range within `name`; null = matched via description or empty query. */
  match: { start: number; end: number } | null;
}

