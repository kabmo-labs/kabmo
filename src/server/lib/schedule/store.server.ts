/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SQLite-backed store for scheduled tasks (`scheduled_tasks` +
 * `scheduled_task_runs`).
 *
 * The server owns the clock: `next_run_at` is a stored column, not a derived
 * one, and the tick ADVANCES it in the same transaction that claims the task.
 * That is what makes two ticks (or two Kabmo instances on one database) safe
 * — the second sees the row already moved past its own `now` and takes nothing.
 * A claim is therefore a write, not a read: `claimDueTasks` returns tasks that
 * have already been rescheduled, and the dispatcher only has to run them.
 *
 * A `once` task is claimed exactly once and disabled by its own claim (its
 * `next_run_at` becomes NULL), so a fire time in the past cannot re-fire on
 * every subsequent tick after a restart.
 */

import { getDb } from '@/server/db.server';
import { withTransaction } from '@/shared/lib/db/transaction.server';
import { nextRunAfter, validateSchedule } from '@/shared/lib/schedule/parse';
import { rowToRun, rowToScheduledTask, type RunRow, type TaskRow } from '@/server/lib/schedule/rows.server';
import type {
  ScheduleKind,
  ScheduleRunStatus,
  ScheduledTask,
  ScheduledTaskModel,
  ScheduledTaskRun,
} from '@/shared/types/schedule';

/** Runs kept per task; the panel shows the newest handful, and an interval
 *  task would otherwise grow the table without bound. */
export const RUN_HISTORY_LIMIT = 50;

export async function listScheduledTasks(): Promise<ScheduledTask[]> {
  const db = await getDb();
  const rows = (await db.all(
    'SELECT * FROM scheduled_tasks ORDER BY enabled DESC, COALESCE(next_run_at, 9223372036854775807) ASC, created_at ASC',
  )) as TaskRow[];
  return rows.map(rowToScheduledTask);
}

export async function getScheduledTask(id: string): Promise<ScheduledTask | null> {
  const db = await getDb();
  const row = (await db.get('SELECT * FROM scheduled_tasks WHERE id = ?', [id])) as TaskRow | undefined;
  return row ? rowToScheduledTask(row) : null;
}

export async function listScheduledTaskRuns(taskId: string, limit = RUN_HISTORY_LIMIT): Promise<ScheduledTaskRun[]> {
  const db = await getDb();
  const rows = (await db.all(
    'SELECT * FROM scheduled_task_runs WHERE task_id = ? ORDER BY started_at DESC LIMIT ?',
    [taskId, limit],
  )) as RunRow[];
  return rows.map(rowToRun);
}

export interface ScheduledTaskInput {
  name: string;
  prompt: string;
  kind: ScheduleKind;
  spec: string;
  folderId: number | null;
  cwd: string | null;
  sessionId: string | null;
  model: ScheduledTaskModel | null;
}

/**
 * Insert a task. The schedule is validated here rather than trusted from the
 * caller: this is the last gate before the row, and an unparseable spec would
 * be a task the runtime can only skip forever.
 */
export async function createScheduledTask(input: ScheduledTaskInput): Promise<ScheduledTask> {
  const validation = validateSchedule(input.kind, input.spec);
  if (!validation.ok) throw new Error(validation.error);
  const db = await getDb();
  const now = Date.now();
  const id = crypto.randomUUID();
  await db.run(
    `INSERT INTO scheduled_tasks
       (id, name, prompt, kind, spec, folder_id, cwd, session_id,
        provider, model_id, thinking_level, access_mode,
        enabled, next_run_at, run_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0, ?, ?)`,
    [
      id, input.name, input.prompt, input.kind, input.spec.trim(), input.folderId, input.cwd, input.sessionId,
      input.model?.provider ?? null, input.model?.modelId ?? null,
      input.model?.thinkingLevel ?? null, input.model?.accessMode ?? null,
      validation.nextRunAt, now, now,
    ],
  );
  return (await getScheduledTask(id))!;
}

export interface ScheduledTaskPatch {
  name?: string;
  prompt?: string;
  kind?: ScheduleKind;
  spec?: string;
  folderId?: number | null;
  cwd?: string | null;
  sessionId?: string | null;
  model?: ScheduledTaskModel | null;
  enabled?: boolean;
}

/**
 * Patch a task. A change to the schedule or to `enabled` RECOMPUTES
 * `next_run_at` from now, because the old value describes a schedule that no
 * longer exists: an edit from `1h` to `1d` that kept the pending hour would
 * fire once on the old cadence, and re-enabling a paused task would fire
 * immediately for every interval it spent paused.
 */
export async function updateScheduledTask(id: string, patch: ScheduledTaskPatch): Promise<ScheduledTask | null> {
  const existing = await getScheduledTask(id);
  if (!existing) return null;

  const kind = patch.kind ?? existing.kind;
  const spec = patch.spec !== undefined ? patch.spec.trim() : existing.spec;
  const enabled = patch.enabled ?? existing.enabled;
  const scheduleChanged = patch.kind !== undefined || patch.spec !== undefined;

  let nextRunAt = existing.nextRunAt;
  if (scheduleChanged || (enabled && !existing.enabled)) {
    // The old clock described a schedule (or a pause) that no longer applies.
    if (!enabled) {
      nextRunAt = null;
    } else {
      const validation = validateSchedule(kind, spec);
      if (!validation.ok) throw new Error(validation.error);
      nextRunAt = validation.nextRunAt;
    }
  } else if (!enabled) {
    nextRunAt = null;
  }

  const model = patch.model !== undefined ? patch.model : existing.model;
  const db = await getDb();
  await db.run(
    `UPDATE scheduled_tasks SET
       name = ?, prompt = ?, kind = ?, spec = ?, folder_id = ?, cwd = ?, session_id = ?,
       provider = ?, model_id = ?, thinking_level = ?, access_mode = ?,
       enabled = ?, next_run_at = ?, updated_at = ?
     WHERE id = ?`,
    [
      patch.name ?? existing.name,
      patch.prompt ?? existing.prompt,
      kind,
      spec,
      patch.folderId !== undefined ? patch.folderId : existing.folderId,
      patch.cwd !== undefined ? patch.cwd : existing.cwd,
      patch.sessionId !== undefined ? patch.sessionId : existing.sessionId,
      model?.provider ?? null,
      model?.modelId ?? null,
      model?.thinkingLevel ?? null,
      model?.accessMode ?? null,
      enabled ? 1 : 0,
      nextRunAt,
      Date.now(),
      id,
    ],
  );
  return getScheduledTask(id);
}

export async function deleteScheduledTask(id: string): Promise<boolean> {
  const db = await getDb();
  return withTransaction(db, () => {
    db.raw.run('DELETE FROM scheduled_task_runs WHERE task_id = ?', [id]);
    const result = db.raw.run('DELETE FROM scheduled_tasks WHERE id = ?', [id]);
    return result.changes > 0;
  });
}

/**
 * Claim every task due at `now`, advancing each one's schedule inside the same
 * transaction. Returns the claimed tasks for the caller to dispatch.
 *
 * `once` is disabled by the claim itself rather than by the dispatcher: if the
 * dispatch throws, the task must still not fire again, or a failing one-shot
 * would retry forever. The run record is what reports the failure.
 */
export async function claimDueTasks(now: number): Promise<ScheduledTask[]> {
  const db = await getDb();
  return withTransaction(db, () => {
    const rows = db.raw
      .query(
        `SELECT * FROM scheduled_tasks
         WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?
         ORDER BY next_run_at ASC`,
      )
      .all(now) as TaskRow[];
    const claimed: ScheduledTask[] = [];
    for (const row of rows) {
      const task = rowToScheduledTask(row);
      const next = nextRunAfter(task.kind, task.spec, now);
      db.raw.run(
        'UPDATE scheduled_tasks SET next_run_at = ?, enabled = ?, updated_at = ? WHERE id = ?',
        [next, next === null ? 0 : 1, now, task.id],
      );
      claimed.push({ ...task, nextRunAt: next, enabled: next !== null });
    }
    return claimed;
  });
}

/** Open a run record; returns its id for the matching `finishScheduledRun`. */
export async function startScheduledRun(taskId: string, sessionId: string | null): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  await db.run(
    `INSERT INTO scheduled_task_runs (id, task_id, session_id, status, detail, started_at)
     VALUES (?, ?, ?, 'running', '', ?)`,
    [id, taskId, sessionId, Date.now()],
  );
  return id;
}

/**
 * Close a run and stamp the task's own last-run fields. `countRun: false` is
 * for a manual "Run now", which must not inflate the schedule's fire count.
 */
export async function finishScheduledRun(
  runId: string,
  taskId: string,
  status: Exclude<ScheduleRunStatus, 'running'>,
  detail: string,
  options: { sessionId?: string | null; countRun?: boolean } = {},
): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  withTransaction(db, () => {
    db.raw.run(
      'UPDATE scheduled_task_runs SET status = ?, detail = ?, finished_at = ?, session_id = COALESCE(?, session_id) WHERE id = ?',
      [status, detail, now, options.sessionId ?? null, runId],
    );
    db.raw.run(
      `UPDATE scheduled_tasks SET last_run_at = ?, last_status = ?, last_error = ?,
         run_count = run_count + ?, updated_at = ? WHERE id = ?`,
      [now, status, status === 'error' ? detail : null, options.countRun === false ? 0 : 1, now, taskId],
    );
  });
  // Keep the table bounded per task; the panel shows the newest handful.
  await db.run(
    `DELETE FROM scheduled_task_runs WHERE task_id = ? AND id NOT IN (
       SELECT id FROM scheduled_task_runs WHERE task_id = ? ORDER BY started_at DESC LIMIT ?
     )`,
    [taskId, taskId, RUN_HISTORY_LIMIT],
  );
}
