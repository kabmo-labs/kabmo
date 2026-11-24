/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Kabmo change journal's line shapes.
 *
 * One JSON object per line, append-only. The journal is Kabmo's own record of
 * what a run did to the working tree — not omp's `changes.jsonl`, which only
 * sees the edit tools. The extra fields are the point: `toolCallId` joins a
 * write to the call that made it, `source` says which capture layer saw it, and
 * `command`/`exit` make a `bash` mutation explainable.
 *
 * `before`/`after` are blob keys, `null` when the file did not exist, and
 * `undefined` when the content was not stored (over the cap). A `note` line is
 * how the journal says "I could not capture this" instead of guessing.
 */

import type { MutationOp } from '@/server/lib/changes/classify-command';

export interface JournalSessionRecord {
  v: 1;
  type: 'session';
  at: number;
  sessionId: string;
  cwd: string;
  omp?: string;
  kabmo?: string;
}

export interface JournalRunRecord {
  v: 1;
  type: 'run';
  phase: 'start' | 'end';
  runId: string;
  at: number;
}

export interface JournalCallRecord {
  v: 1;
  type: 'call';
  at: number;
  /** The run this call belongs to; absent on a journal written before runs. */
  runId?: string;
  /** The run's `agent_start` time, so a reader can map it to a chat run. */
  runAt?: number;
  toolCallId: string;
  agent: string;
  parent?: string;
  tool: string;
  intent?: string;
  /** The call's arguments, truncated to a bounded JSON string. */
  args?: unknown;
  argsTruncated?: boolean;
}

export interface JournalChangeRecord {
  v: 1;
  type: 'change';
  at: number;
  runId?: string;
  runAt?: number;
  toolCallId?: string;
  agent: string;
  parent?: string;
  tool: string;
  op: MutationOp;
  /** Absolute path after the write. */
  path: string;
  /** Absolute source path, for a rename. */
  from?: string;
  displayPath: string;
  before: string | null | undefined;
  after: string | null | undefined;
  beforeMtimeMs?: number;
  afterMtimeMs?: number;
  source: 'tool' | 'trace' | 'scan' | 'omp-import';
  command?: string;
  exit?: number;
  /** Why a side is `undefined`; absent when the reason is the blob cap. */
  unavailableReason?: 'too-large' | 'snapshot-race';
}

export interface JournalCommitRecord {
  v: 1;
  type: 'commit';
  at: number;
  sha: string;
  paths: string[];
}

export interface JournalNoteRecord {
  v: 1;
  type: 'note';
  at: number;
  runId?: string;
  runAt?: number;
  toolCallId?: string;
  reason: 'too-large' | 'opaque-command' | 'scan-budget' | 'snapshot-race' | 'unknown-tool';
  detail?: string;
}

export type JournalRecord =
  | JournalSessionRecord
  | JournalRunRecord
  | JournalCallRecord
  | JournalChangeRecord
  | JournalCommitRecord
  | JournalNoteRecord;

/** Parse one journal line; `null` for a torn or foreign line. */
export function parseJournalLine(line: string): JournalRecord | null {
  if (!line) return null;
  try {
    const value = JSON.parse(line) as Record<string, unknown>;
    if (value?.v !== 1 || typeof value.type !== 'string') return null;
    return value as unknown as JournalRecord;
  } catch {
    return null;
  }
}
