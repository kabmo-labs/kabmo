/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * oh-my-pi's `todo` tool state, as Kabmo reads it.
 *
 * omp owns this list, not Kabmo: the `todo` tool writes a structured
 * snapshot into the session JSONL (a `toolResult` entry's `details.phases`, or
 * a `user_todo_edit` custom entry when the operator edits the list by hand), and
 * every later branch rehydration — resume, rewind, fork, `/btw` — reads the
 * DEEPEST such snapshot on the active branch back out of it
 * (`getLatestTodoPhasesFromEntries`). The Kabmo mirrors exactly that read, so
 * the panel and the agent's own HUD cannot disagree about what is open.
 *
 * The status vocabulary is omp's, including the two states Kabmo's chat
 * timeline never rendered before: `blocked` (waiting on something, with an
 * optional note) and `abandoned` (deliberately dropped). Both are settled-but-
 * not-done, which is why `isClosedTodo` — not `status === 'completed'` — is
 * what any progress counter must use.
 */

/** Lifecycle state of one todo item (omp's `TodoStatus`). */
export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'abandoned' | 'blocked';

/** One task inside a phase. */
export interface TodoItem {
  content: string;
  status: TodoStatus;
  /** Present on a `blocked` task: what it is waiting for. */
  blocker?: string;
  details?: string;
  notes?: string[];
}

/** A named group of tasks. */
export interface TodoPhase {
  name: string;
  tasks: TodoItem[];
}

/** The `todo` op that produced a snapshot; absent on legacy transcript entries. */
export type TodoOperation =
  | 'init'
  | 'start'
  | 'done'
  | 'rm'
  | 'drop'
  | 'block'
  | 'unblock'
  | 'append'
  | 'view';

/**
 * Where the snapshot that resolved the list came from. A `toolResult` entry
 * only exists when the `todo` tool actually ran in this transcript; the
 * `custom` variant is omp's own durable rehydration record (a hand edit from
 * the `/todo` command, a HUD reveal, or the auto-complete omp performs when a
 * subagent matching a task description finishes). The distinction is
 * diagnostic: "the agent never used todos here" and "the agent used them and
 * then edited them by hand" look identical without it.
 */
export type TodoSnapshotSource = 'toolResult' | 'custom';

/** The resolved todo list for a session, plus the entry that carried it. */
export interface TodoSnapshot {
  phases: TodoPhase[];
  /** Entry id of the snapshot — what a later snapshot has to beat. */
  sourceEntryId: string;
  source: TodoSnapshotSource;
  /** ISO timestamp of the snapshot entry, when it carries one. */
  updatedAt?: string;
  /** Op that produced it, when the entry records one. */
  op?: TodoOperation;
  /** omp's own storage mode: `session` (durable) or `memory` (no session file). */
  storage?: 'session' | 'memory';
}

/** Rolled-up counters over a snapshot's tasks. */
export interface TodoProgress {
  total: number;
  completed: number;
  /** `completed` + `abandoned` — the pair omp's HUD hides as settled. */
  closed: number;
  inProgress: number;
  pending: number;
  blocked: number;
  abandoned: number;
}

/** One session's todo state as the panel consumes it. */
export interface SessionTodoState {
  /** null when this session's transcript holds no committed snapshot. */
  snapshot: TodoSnapshot | null;
  /** Roll-up over the snapshot's tasks; all zeros when there is none. */
  progress: TodoProgress;
}

/** Wire payload of the session's `todos` realtime topic. */
export interface SessionTodosPayload extends SessionTodoState {
  sessionId: string;
  /** ISO timestamp of the resolve. */
  generatedAt: string;
  isMock: boolean;
  /** Set when the session has no readable transcript (never written, or gone). */
  error?: string;
}
