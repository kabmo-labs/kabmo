/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Parse oh-my-pi's persisted `todo` state out of a session transcript.
 *
 * omp keeps the authoritative list in its own session file, not in an
 * in-memory HUD: the `todo` tool commits a snapshot to the entry it appends,
 * and omp reads the deepest snapshot back off the ACTIVE BRANCH when it
 * rehydrates (`getLatestTodoPhasesFromEntries` → `syncTodoPhasesFromBranch`).
 * This module performs the same read, so Kabmo's panel shows what the
 * agent itself would resume with.
 *
 * Two rules are load-bearing and each was verified against omp 18.3.0:
 *
 *   - **The active branch, not file order.** A session file is a tree: every
 *     entry carries `parentId`, and a rewind/fork leaves entries on the file
 *     that the current leaf no longer descends from. omp reads `getBranch()`
 *     (leaf → root), so file order would resurrect a todo list the agent had
 *     already rewound past.
 *   - **A `view` snapshot is not a snapshot.** `todo op=view` returns the
 *     current list without committing it; a `view` result's phases may be
 *     stale, so omp skips those results entirely and so does this reader.
 *     Errored results are skipped for the same reason.
 */

import { isRecord } from '@/shared/lib/util/guards';
import type {
  TodoItem,
  TodoOperation,
  TodoPhase,
  TodoProgress,
  TodoSnapshot,
} from '@/shared/types/todo';

const TODO_STATUSES: Record<string, true> = {
  pending: true,
  in_progress: true,
  completed: true,
  abandoned: true,
  blocked: true,
};

/** Custom-entry type omp writes for a durable, non-tool todo mutation. */
const USER_TODO_EDIT_CUSTOM_TYPE = 'user_todo_edit';

/** Whether an unknown value is one omp-persisted phase. */
export function isTodoPhase(value: unknown): value is TodoPhase {
  if (!isRecord(value) || typeof value.name !== 'string' || !Array.isArray(value.tasks)) return false;
  return value.tasks.every((task) => {
    if (!isRecord(task) || typeof task.content !== 'string') return false;
    return typeof task.status === 'string' && TODO_STATUSES[task.status] === true;
  });
}

/** Narrow an unknown array to a validated phase list, or undefined. */
function toPhases(value: unknown): TodoPhase[] | undefined {
  if (!Array.isArray(value) || !value.every(isTodoPhase)) return undefined;
  return value as TodoPhase[];
}

/** One JSONL entry as this reader needs it. */
interface TodoEntryLike {
  id?: unknown;
  parentId?: unknown;
  timestamp?: unknown;
  type?: unknown;
  customType?: unknown;
  data?: unknown;
  message?: unknown;
}

/**
 * The phases an entry commits, or undefined when it commits none.
 *
 * Mirrors omp's own `aVn`: a `user_todo_edit` custom entry carries `data.phases`
 * (already-normalized), and a `todo` toolResult carries `details.phases` unless
 * it errored or was a pure `view` read.
 */
function committedPhases(entry: TodoEntryLike): TodoPhase[] | undefined {
  if (entry.type === 'custom' && entry.customType === USER_TODO_EDIT_CUSTOM_TYPE) {
    const data = isRecord(entry.data) ? entry.data : undefined;
    return toPhases(data?.phases);
  }
  if (entry.type !== 'message') return undefined;
  const message = isRecord(entry.message) ? entry.message : undefined;
  if (!message || message.role !== 'toolResult' || message.toolName !== 'todo') return undefined;
  if (message.isError === true) return undefined;
  const details = isRecord(message.details) ? message.details : undefined;
  if (details?.op === 'view') return undefined;
  return toPhases(details?.phases);
}

/** The chain of entry ids from the session's leaf back to the root. */
function activeBranchIds(entries: TodoEntryLike[]): Set<string> {
  const parentOf = new Map<string, string | null>();
  for (const entry of entries) {
    if (typeof entry.id !== 'string') continue;
    parentOf.set(entry.id, typeof entry.parentId === 'string' ? entry.parentId : null);
  }
  const branch = new Set<string>();
  // The leaf is the last entry in file order: omp appends as it advances, so
  // the newest entry is where the conversation currently stands.
  let cursor: string | null | undefined = undefined;
  for (let i = entries.length - 1; i >= 0; i--) {
    const id = entries[i]?.id;
    if (typeof id === 'string') {
      cursor = id;
      break;
    }
  }
  while (typeof cursor === 'string' && !branch.has(cursor)) {
    branch.add(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }
  return branch;
}

/**
 * The deepest committed todo snapshot on the active branch, or null when this
 * transcript holds none. The returned `sourceEntryId` is the entry a later
 * snapshot has to beat — omp's own identity for the list.
 */
export function latestTodoSnapshot(entries: readonly unknown[]): TodoSnapshot | null {
  const typed = entries as TodoEntryLike[];
  const branch = activeBranchIds(typed);

  for (let i = typed.length - 1; i >= 0; i--) {
    const entry = typed[i];
    const id = entry?.id;
    // An entry with no id cannot be placed on the branch; a legacy file may
    // still carry usable snapshots, so it is read but never claims identity.
    if (typeof id === 'string' && !branch.has(id)) continue;
    const phases = committedPhases(entry);
    if (!phases) continue;
    return {
      phases,
      sourceEntryId: typeof id === 'string' ? id : '',
      source: entry.type === 'custom' ? 'custom' : 'toolResult',
      ...(typeof entry.timestamp === 'string' ? { updatedAt: entry.timestamp } : {}),
      ...readOp(entry),
    };
  }
  return null;
}

/** Op + storage recorded on the snapshot entry, when it carries them. */
function readOp(entry: TodoEntryLike): { op?: TodoOperation; storage?: 'session' | 'memory' } {
  const details =
    entry.type === 'message'
      ? (isRecord(entry.message) ? (isRecord(entry.message.details) ? entry.message.details : undefined) : undefined)
      : undefined;
  if (!details) return {};
  const op = typeof details.op === 'string' ? (details.op as TodoOperation) : undefined;
  const storage = details.storage === 'session' || details.storage === 'memory' ? details.storage : undefined;
  return { ...(op ? { op } : {}), ...(storage ? { storage } : {}) };
}

/** Counter roll-up over every task in a snapshot. */
export function todoProgress(phases: readonly TodoPhase[]): TodoProgress {
  const progress: TodoProgress = {
    total: 0,
    completed: 0,
    closed: 0,
    inProgress: 0,
    pending: 0,
    blocked: 0,
    abandoned: 0,
  };
  for (const phase of phases) {
    for (const task of phase.tasks) {
      progress.total += 1;
      switch (task.status) {
        case 'completed':
          progress.completed += 1;
          progress.closed += 1;
          break;
        case 'abandoned':
          progress.abandoned += 1;
          progress.closed += 1;
          break;
        case 'in_progress':
          progress.inProgress += 1;
          break;
        case 'blocked':
          progress.blocked += 1;
          break;
        default:
          progress.pending += 1;
          break;
      }
    }
  }
  return progress;
}

/**
 * The task the agent is on right now: an `in_progress` one if any, else the
 * first `pending`. omp picks the same way for its own "next actionable" row.
 */
export function nextActionableTask(phases: readonly TodoPhase[]): TodoItem | undefined {
  for (const phase of phases) {
    for (const task of phase.tasks) {
      if (task.status === 'in_progress') return task;
    }
  }
  for (const phase of phases) {
    for (const task of phase.tasks) {
      if (task.status === 'pending') return task;
    }
  }
  return undefined;
}
