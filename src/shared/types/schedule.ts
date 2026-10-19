/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Scheduled tasks: a prompt Kabmo sends to an omp session on a clock.
 *
 * The row is Kabmo's own record (SQLite `scheduled_tasks`) — omp has no
 * scheduler of its own, so Kabmo owns the clock and the dispatch. A run
 * is either a fresh omp session per fire (`sessionId: null`) or a resume of one
 * named session, which is what makes "every morning, in this conversation"
 * possible without a second conversation per day.
 */

import type { QueuedMessageModel } from '@/shared/types/chat';

/** How `spec` is interpreted. */
export type ScheduleKind = 'once' | 'every' | 'cron';

/**
 * `once`   — `spec` is an ISO-8601 timestamp.
 * `every`  — `spec` is an interval expression (`30s`, `5m`, `1h30m`, `2d`).
 * `cron`   — `spec` is a 5-field cron expression (`0 9 * * 1-5`).
 */
export type ScheduledTaskModel = QueuedMessageModel;

export type ScheduleRunStatus = 'running' | 'success' | 'error';

export interface ScheduledTask {
  id: string;
  /** Display name; falls back to a prompt excerpt when empty. */
  name: string;
  prompt: string;
  kind: ScheduleKind;
  spec: string;
  /** Workspace folder the run starts in; null uses the server's default cwd. */
  folderId: number | null;
  /** Resolved at creation from the folder, so a deleted folder cannot strand it. */
  cwd: string | null;
  /** Resume this omp session every run instead of starting a new one. */
  sessionId: string | null;
  /** Model snapshot replayed at dispatch; null uses the persisted selection. */
  model: ScheduledTaskModel | null;
  enabled: boolean;
  /** Epoch ms of the next fire; null while paused or after a one-shot ran. */
  nextRunAt: number | null;
  lastRunAt: number | null;
  lastStatus: ScheduleRunStatus | null;
  lastError: string | null;
  /** How many times this task has fired (successful dispatches). */
  runCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface ScheduledTaskRun {
  id: string;
  taskId: string;
  /** The omp session this run drove, once it was known. */
  sessionId: string | null;
  status: ScheduleRunStatus;
  /** Failure text, or a short note on how the run was dispatched. */
  detail: string;
  startedAt: number;
  finishedAt: number | null;
}
