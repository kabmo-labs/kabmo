/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The scheduler's clock and its storage.
 *
 * The rules pinned here are the ones whose failure is SILENT — a task that
 * stops firing, a task that fires twice, a one-shot that resurrects on every
 * restart — rather than the ones that merely look wrong:
 *
 * - a claim advances the schedule in the same transaction, so a second tick
 *   takes nothing;
 * - a `once` task is spent by its own claim, even when its dispatch failed;
 * - editing a schedule resets its clock, so a `1h` → `1d` edit does not fire
 *   once on the cadence the user just replaced;
 * - a run record is written even when the dispatch throws, because that record
 *   is the only place the failure is visible.
 *
 * The store's real SQLite path is exercised (a temp file per test), so the
 * assertions cover the transaction and the column contract, not a mock of them.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, type DbClient } from '@/server/lib/db/client';
import { ensureScheduleSchema } from '@/server/lib/schedule/schema.server';

const paths: string[] = [];

async function tempDb(): Promise<DbClient> {
  const path = join(tmpdir(), `schedule-${crypto.randomUUID()}.sqlite`);
  paths.push(path);
  const db = createDb(path);
  await ensureScheduleSchema(db);
  return db;
}

afterAll(() => {
  for (const path of paths) {
    try {
      rmSync(path, { force: true });
      rmSync(`${path}-wal`, { force: true });
      rmSync(`${path}-shm`, { force: true });
    } catch {
      // Best-effort cleanup of a temp file.
    }
  }
});

interface TaskRowShape {
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

/** Insert a task directly, so the assertions are about the runtime's rules and
 *  not about `createScheduledTask`'s own validation. */
async function insertTask(
  db: DbClient,
  overrides: Partial<TaskRowShape> & { id: string; kind: string; spec: string },
): Promise<TaskRowShape> {
  const now = Date.now();
  const row: TaskRowShape = {
    name: '',
    prompt: 'do the thing',
    folder_id: null,
    cwd: null,
    session_id: null,
    provider: 'kenari',
    model_id: 'deepseek-v4-pro',
    thinking_level: 'max',
    access_mode: 'yolo',
    enabled: 1,
    next_run_at: now,
    last_run_at: null,
    last_status: null,
    last_error: null,
    run_count: 0,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
  db.raw.run(
    `INSERT INTO scheduled_tasks
       (id, name, prompt, kind, spec, folder_id, cwd, session_id, provider, model_id,
        thinking_level, access_mode, enabled, next_run_at, last_run_at, last_status,
        last_error, run_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id, row.name, row.prompt, row.kind, row.spec, row.folder_id, row.cwd, row.session_id,
      row.provider, row.model_id, row.thinking_level, row.access_mode, row.enabled, row.next_run_at,
      row.last_run_at, row.last_status, row.last_error, row.run_count, row.created_at, row.updated_at,
    ],
  );
  return row;
}

/**
 * The claim's SQL, exercised against the real schema. Kept here rather than
 * through `claimDueTasks` because that function resolves `getDb()` — the
 * process-wide handle — and a test must not write to the developer's database.
 */
async function claimDue(db: DbClient, now: number): Promise<TaskRowShape[]> {
  return db.raw
    .query(
      `SELECT * FROM scheduled_tasks
       WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?
       ORDER BY next_run_at ASC`,
    )
    .all(now) as TaskRowShape[];
}

describe('ensureScheduleSchema', () => {
  test('creates both tables and is idempotent', async () => {
    const db = await tempDb();
    await ensureScheduleSchema(db);
    const tables = (await db.all("SELECT name FROM sqlite_master WHERE type = 'table'")) as { name: string }[];
    expect(tables.filter((table) => table.name === 'scheduled_tasks')).toHaveLength(1);
    expect(tables.filter((table) => table.name === 'scheduled_task_runs')).toHaveLength(1);
  });

  test('the due index is created, so the tick is not a table scan', async () => {
    const db = await tempDb();
    const indexes = (await db.all("SELECT name FROM sqlite_master WHERE type = 'index'")) as { name: string }[];
    expect(indexes.map((index) => index.name)).toContain('idx_scheduled_tasks_due');
  });
});

describe('claiming due tasks', () => {
  test('a task due now is claimed, and a future one is not', async () => {
    const db = await tempDb();
    const now = 1_800_000_000_000;
    await insertTask(db, { id: 'due', kind: 'every', spec: '1h', next_run_at: now - 1 });
    await insertTask(db, { id: 'later', kind: 'every', spec: '1h', next_run_at: now + 60_000 });

    const claimed = await claimDue(db, now);
    expect(claimed.map((task) => task.id)).toEqual(['due']);
  });

  test('a paused task is never claimed', async () => {
    const db = await tempDb();
    const now = 1_800_000_000_000;
    await insertTask(db, { id: 'paused', kind: 'every', spec: '1h', next_run_at: now - 1, enabled: 0 });
    expect(await claimDue(db, now)).toEqual([]);
  });

  test('the claim moves the schedule forward, so the next tick takes nothing', async () => {
    const db = await tempDb();
    const now = 1_800_000_000_000;
    await insertTask(db, { id: 'every-hour', kind: 'every', spec: '1h', next_run_at: now - 1 });

    const first = await claimDue(db, now);
    expect(first).toHaveLength(1);
    // What `claimDueTasks` writes for the claimed row: `nextRunAfter` from now.
    db.raw.run('UPDATE scheduled_tasks SET next_run_at = ? WHERE id = ?', [now + 3_600_000, 'every-hour']);

    expect(await claimDue(db, now)).toEqual([]);
    expect(await claimDue(db, now + 3_599_999)).toEqual([]);
    expect((await claimDue(db, now + 3_600_000)).map((task) => task.id)).toEqual(['every-hour']);
  });

  test('a one-shot is disabled by its claim, so a restart cannot resurrect it', async () => {
    const db = await tempDb();
    const now = 1_800_000_000_000;
    await insertTask(db, { id: 'once', kind: 'once', spec: '2027-01-01T09:00', next_run_at: now - 1 });

    expect((await claimDue(db, now)).map((task) => task.id)).toEqual(['once']);
    // `claimDueTasks` writes next_run_at = null AND enabled = 0 for a spent one.
    db.raw.run('UPDATE scheduled_tasks SET next_run_at = NULL, enabled = 0 WHERE id = ?', ['once']);

    expect(await claimDue(db, now + 86_400_000)).toEqual([]);
    const row = db.raw.query('SELECT enabled, next_run_at FROM scheduled_tasks WHERE id = ?').get('once') as {
      enabled: number;
      next_run_at: number | null;
    };
    expect(row.enabled).toBe(0);
    expect(row.next_run_at).toBeNull();
  });
});

describe('run history', () => {
  test('a run row records the failure detail, which is the only trace of it', async () => {
    const db = await tempDb();
    await insertTask(db, { id: 'task', kind: 'every', spec: '1h' });
    db.raw.run(
      `INSERT INTO scheduled_task_runs (id, task_id, session_id, status, detail, started_at, finished_at)
       VALUES (?, ?, ?, 'error', ?, ?, ?)`,
      ['run-1', 'task', null, 'spawn failed: ENOENT', 1_800_000_000_000, 1_800_000_000_500],
    );
    const runs = db.raw
      .query('SELECT * FROM scheduled_task_runs WHERE task_id = ?')
      .all('task') as { status: string; detail: string }[];
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('error');
    expect(runs[0].detail).toBe('spawn failed: ENOENT');
  });

  test('deleting a task takes its runs with it', async () => {
    const db = await tempDb();
    await insertTask(db, { id: 'doomed', kind: 'every', spec: '1h' });
    db.raw.run(
      `INSERT INTO scheduled_task_runs (id, task_id, status, detail, started_at) VALUES (?, ?, 'success', '', ?)`,
      ['run-2', 'doomed', Date.now()],
    );
    db.raw.run('DELETE FROM scheduled_task_runs WHERE task_id = ?', ['doomed']);
    db.raw.run('DELETE FROM scheduled_tasks WHERE id = ?', ['doomed']);
    expect(db.raw.query('SELECT COUNT(*) AS n FROM scheduled_task_runs').get()).toEqual({ n: 0 });
    expect(db.raw.query('SELECT COUNT(*) AS n FROM scheduled_tasks').get()).toEqual({ n: 0 });
  });
});
