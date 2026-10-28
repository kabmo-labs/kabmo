/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Row shapes and row→domain mapping for `scheduled_tasks` /
 * `scheduled_task_runs`. Split from `store.server.ts` so both stay under the
 * repo's per-file size ceiling; the store owns queries, this owns the column
 * contract. Kept exported because the runtime's dispatch reads a claimed task
 * through the same mapper the panel does.
 */

import { isApprovalMode } from '@/shared/lib/omp/config/access-mode';
import type {
  ScheduleKind,
  ScheduleRunStatus,
  ScheduledTask,
  ScheduledTaskModel,
  ScheduledTaskRun,
} from '@/shared/types/schedule';

export interface TaskRow {
  id: string;
  name: string;
  prompt: string;
  kind: string;
  spec: string;
  folder_id: number | null;
  cwd: string | null;
  session_id: string | null;
  provider: string | null;
  model_id: string | null;
  thinking_level: string | null;
  access_mode: string | null;
  enabled: number;
  next_run_at: number | null;
  last_run_at: number | null;
  last_status: string | null;
  last_error: string | null;
  run_count: number;
  created_at: number;
  updated_at: number;
}

export interface RunRow {
  id: string;
  task_id: string;
  session_id: string | null;
  status: string;
  detail: string;
  started_at: number;
  finished_at: number | null;
}

const KINDS: readonly ScheduleKind[] = ['once', 'every', 'cron'];
const RUN_STATUSES: readonly ScheduleRunStatus[] = ['running', 'success', 'error'];

/** A stored value that predates or outlives the vocabulary reads as its safe
 *  default rather than throwing on every list. */
export function isScheduleKind(value: unknown): value is ScheduleKind {
  return typeof value === 'string' && KINDS.some((kind) => kind === value);
}

export function isRunStatus(value: unknown): value is ScheduleRunStatus {
  return typeof value === 'string' && RUN_STATUSES.some((status) => status === value);
}

function taskModelFromRow(row: TaskRow): ScheduledTaskModel | null {
  if (!row.provider || !row.model_id) return null;
  return {
    provider: row.provider,
    modelId: row.model_id,
    thinkingLevel: row.thinking_level ?? 'auto',
    accessMode: isApprovalMode(row.access_mode) ? row.access_mode : 'always-ask',
  };
}

export function rowToScheduledTask(row: TaskRow): ScheduledTask {
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    kind: isScheduleKind(row.kind) ? row.kind : 'every',
    spec: row.spec,
    folderId: row.folder_id,
    cwd: row.cwd,
    sessionId: row.session_id,
    model: taskModelFromRow(row),
    enabled: row.enabled === 1,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    lastStatus: isRunStatus(row.last_status) ? row.last_status : null,
    lastError: row.last_error,
    runCount: row.run_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToRun(row: RunRow): ScheduledTaskRun {
  return {
    id: row.id,
    taskId: row.task_id,
    sessionId: row.session_id,
    status: isRunStatus(row.status) ? row.status : 'error',
    detail: row.detail,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}
