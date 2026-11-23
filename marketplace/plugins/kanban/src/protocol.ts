/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The shapes both halves of the Kanban share.
 *
 * The panel (a browser), the plugin's server half (Kabmo's process) and the MCP
 * child (its own process) all read and write the SAME files, so every type here
 * is the file format itself rather than a wire-only shape. Two rules follow:
 *
 * - **A card is a CONTROL record.** Title, stage, priority, workspace, the task
 *   (prompt + images + agent picks) and the linked session. No description, no
 *   comments, no labels — the board drives work, it does not hold knowledge.
 * - **A stage carries the agent configuration**, so moving a card into Review
 *   can change the harness and the system prompt. Resolution is per FIELD and
 *   its chain is `card → stage → board defaults → host default`, which is what
 *   `resolveAgent` reports so the sheet can say where each value came from.
 */

/** The agent settings a card, a stage or the board may name. Every field optional. */
export interface AgentSpec {
  /** A harness id from the host's catalog (`omp-rpc`, `claude`, …). */
  harness?: string;
  /** `provider` + `modelId`, as the host's pickers name them. */
  model?: { provider: string; modelId: string } | null;
  /** A thinking level the harness publishes, or `null` for its own default. */
  thinking?: string | null;
  /** An approval mode (`always-ask`, `write`, `yolo`). */
  access?: string;
  /** Appended to omp's own system prompt; prepended to the first turn on ACP. */
  prompt?: string;
  /** Comma-free globs that narrow the skill catalog for a spawned session. */
  skills?: string[];
}

/** One stage (a column). `session` marks the stages that run an agent. */
export interface Stage {
  id: string;
  label: string;
  hidden: boolean;
  /** True when landing here should start (or continue) a session. */
  session: boolean;
  agent?: AgentSpec;
}

/** `board.json`. */
export interface Board {
  schema: 2;
  defaults: AgentSpec;
  stages: Stage[];
  updatedAt: string;
}

/** One image a card carries, in the shape the queue persists. */
export interface TaskImage {
  name: string;
  mimeType: string;
  dataBase64: string;
}

/** The task a card dispatches — a queue message with picks. */
export interface CardTask {
  prompt: string;
  images: TaskImage[];
  agent?: AgentSpec;
}

/** `cards/<id>.json`. */
export interface Card {
  schema: 2;
  id: string;
  title: string;
  status: string;
  priority: number;
  workspace: string | null;
  task: CardTask;
  sessionId: string | null;
  createdAt: string;
  updatedAt: string;
  movedAt: string | null;
}

/** A card as the board list carries it: no prompt, no images. */
export type CardSummary = Omit<Card, 'task'> & { hasPrompt: boolean; imageCount: number };

/** One file the board could not read, named so the panel can show it. */
export interface BoardError {
  path: string;
  message: string;
}

/** One card plus the board it belongs to — what the card sheet reads. */
export interface CardDetail {
  card: Card;
  board: Board;
}

/** What `openBoard` answers. */
export interface BoardSnapshot {
  dataDir: string;
  revision: number;
  board: Board;
  cards: CardSummary[];
  errors: BoardError[];
}

/**
 * What `openBoard` answers.
 *
 * "No board yet" is a STATE, not a transport error: a panel that had to parse a
 * refusal CODE to decide whether to offer Create would break the day the plugin
 * route re-wrapped its errors (it does — a thrown handler becomes
 * `handler_error`). The absence is therefore a value the type can see.
 */
export type BoardRead = ({ exists: true } & BoardSnapshot) | { exists: false; dataDir: string };

/** The plugin's realtime topic: an invalidation signal, never the board itself. */
export interface BoardSignal {
  revision: number;
  at: string;
}

/** Which level a resolved field came from. */
export type AgentOrigin = 'card' | 'stage' | 'defaults' | 'host';

/** A resolved agent, with the origin of every field the sheet displays. */
export interface ResolvedAgent {
  harness: string;
  model: { provider: string; modelId: string } | null;
  thinking: string | null;
  access: string;
  prompt: string;
  skills: string[];
  origin: {
    harness: AgentOrigin;
    model: AgentOrigin;
    thinking: AgentOrigin;
    access: AgentOrigin;
    prompt: AgentOrigin;
    skills: AgentOrigin;
  };
  /** How the prompt reaches the agent on this transport. */
  promptDelivery: 'appended' | 'prepended';
}

/** The RPC refusal codes. A refusal is a value, never a thrown transport error. */
export type KanbanErrorCode =
  | 'no_board'
  | 'not_found'
  | 'invalid'
  | 'stale'
  | 'no_workspace'
  | 'io';

/** The stages a fresh board starts with. `session` marks the working lanes. */
export const DEFAULT_STAGES: readonly Stage[] = [
  { id: 'backlog', label: 'Backlog', hidden: false, session: false },
  { id: 'open', label: 'Todo', hidden: false, session: false },
  { id: 'in_progress', label: 'In Progress', hidden: false, session: true },
  { id: 'review', label: 'Review', hidden: true, session: true },
  { id: 'test', label: 'Test', hidden: true, session: false },
  { id: 'done', label: 'Done', hidden: false, session: false },
];

/** The stage a card moves to when work starts on it. */
export const START_STAGE = 'in_progress';

/** A stage id: lowercase, underscore-separated, and short enough to be a filename. */
export const STAGE_ID = /^[a-z][a-z0-9_]{0,31}$/;
/** A card id. Six hex characters after the prefix. */
export const CARD_ID = /^k-[0-9a-f]{6}$/;

/** The largest system prompt a stage may carry (the host caps it again). */
export const MAX_PROMPT_CHARS = 8_192;
/** How many images one card may hold. */
export const MAX_IMAGES = 4;
/** The byte ceiling for one card's images, decoded. */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
