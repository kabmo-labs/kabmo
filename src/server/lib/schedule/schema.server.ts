/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Scheduled-task schema, kept out of `db.server.ts`'s bootstrap block (same
 * reason `btw/schema.server.ts` is): called once per database open.
 *
 * `next_run_at` is stored, not derived, because a `once` task's fire time IS
 * its spec and a paused task has none — deriving it on every read would have to
 * re-parse the spec and would still not know that a one-shot already fired. The
 * runtime advances it after each fire, and that write is also what makes a
 * crash-and-restart safe: the row says when it is next due, not "how long ago
 * it should have run".
 */

import type { DbClient } from '@/server/lib/db/client';

const SCHEDULE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    prompt TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL,
    spec TEXT NOT NULL,
    folder_id INTEGER,
    cwd TEXT,
    session_id TEXT,
    provider TEXT,
    model_id TEXT,
    thinking_level TEXT,
    access_mode TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    next_run_at INTEGER,
    last_run_at INTEGER,
    last_status TEXT,
    last_error TEXT,
    run_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_due ON scheduled_tasks (enabled, next_run_at);

  CREATE TABLE IF NOT EXISTS scheduled_task_runs (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    session_id TEXT,
    status TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    started_at INTEGER NOT NULL,
    finished_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_scheduled_runs_task ON scheduled_task_runs (task_id, started_at DESC);
`;

/** Idempotent: the scheduler's own tables, created on every database open. */
export async function ensureScheduleSchema(db: DbClient): Promise<void> {
  await db.exec(SCHEDULE_SCHEMA_SQL);
}
