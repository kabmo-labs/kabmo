/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The agent's own change journal, as the chat timeline reads it.
 *
 * omp writes `<sessionFile minus .jsonl>/changes.jsonl` from 18.20.1 on: one
 * `change` record per edit-tool write, carrying the content before and after as
 * content-addressed blob keys. Kabmo reads it to answer "which files did this
 * run touch", which the transcript cannot: a tool call names a path, but only
 * the journal holds the two sides of the write.
 */

/** One `change` record from `changes.jsonl`, with the display path resolved. */
export interface SessionChangeRecord {
  /** Epoch ms the write landed. */
  at: number;
  /** The run this record belongs to; absent on a journal written before runs. */
  runId?: string;
  /** The run's `agent_start` time, for mapping the run to a chat row. */
  runAt?: number;
  /** Registry id of the agent that wrote (`Main`, `AuthLoader`). */
  agent: string;
  /** Parent agent id; absent for the root agent. */
  parent?: string;
  /** Tool that wrote (`edit`, `write`, `ast_edit`, `task`). */
  tool: string;
  /** Absolute path as the journal recorded it. */
  path: string;
  /** `path` relative to the session cwd when inside it, else the absolute path. */
  displayPath: string;
  /** Blob key of the content before the write; `null` when the file did not exist. */
  before: string | null | undefined;
  /** Blob key of the content after the write; `null` when the write deleted the file. */
  after: string | null | undefined;
  /**
   * Whether the file existed before this write, when the journal stores hunks
   * (`base: null` / `sum: '-'`) instead of blob keys. Absent when unknown.
   */
  existedBefore?: boolean;
  /** Whether it existed after the write; absent when the journal has no answer. */
  existsAfter?: boolean;
}

/** One file a run changed, as the collapsed summary lists it. */
export interface ChangedFile {
  /** Absolute path, the journal's own key. */
  path: string;
  /** Path to show the reader. */
  displayPath: string;
  status: 'added' | 'modified' | 'deleted';
  /** Agent that made the run's last write to this path. */
  agent: string;
}

/** One file's net `+`/`−` line counts inside a run window. */
export interface SessionChangeCounts {
  added: number;
  removed: number;
}

/** Why a journal side cannot be read. */
export type SessionChangeUnavailableReason = 'too-large' | 'snapshot-race' | 'unreadable';

/** The two sides of one file's net change in a run, plus a unified patch. */
export interface SessionChangeDiff {
  path: string;
  displayPath: string;
  status: 'added' | 'modified' | 'deleted';
  oldContent: string;
  newContent: string;
  /** Unified diff of the two sides; empty when they are equal. */
  diff: string;
  /** A side was not stored, or its stored copy is gone, so the pair is unknown. */
  unavailable: boolean;
  /** Why a side is unknown; absent when `unavailable` is false. */
  unavailableReason?: SessionChangeUnavailableReason;
  /** The store's content cap that dropped the side; only for `too-large`. */
  unavailableLimitBytes?: number;
}
