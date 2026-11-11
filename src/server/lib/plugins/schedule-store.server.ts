/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A plugin schedule's next fire, on disk.
 *
 * The clock is in memory, but the FIRE TIME is not: a `1h` schedule that
 * restarted its countdown on every boot would fire at a different hour each
 * time the server restarted, and two Kabmo instances on the shared database
 * would both fire it. The row is the claim — the same rule the scheduled-task
 * runtime follows — so a tick that loses the UPDATE does not run the job.
 *
 * A row is written when the plugin declares the schedule and advanced by the
 * claim. Disabling a plugin keeps the row (state survives a switch-off); only
 * removal purges it, through `purgePluginState`.
 */

import type { DbClient } from '@/server/lib/db/client';

/** The stored next fire per schedule id, for one plugin. */
export async function readPluginScheduleState(db: DbClient, pluginId: string): Promise<Map<string, number>> {
  const rows = await db.all<{ id: string; next_run_at: number | null }>(
    'SELECT id, next_run_at FROM plugin_schedules WHERE plugin_id = ?',
    [pluginId],
  );
  const state = new Map<string, number>();
  for (const row of rows) {
    if (typeof row.next_run_at === 'number') state.set(row.id, row.next_run_at);
  }
  return state;
}

/** Record a declared schedule's first fire, without overwriting a stored one. */
export async function insertPluginSchedule(
  db: DbClient,
  pluginId: string,
  id: string,
  nextRunAt: number | null,
): Promise<void> {
  await db.run('INSERT OR IGNORE INTO plugin_schedules (plugin_id, id, next_run_at) VALUES (?, ?, ?)', [
    pluginId,
    id,
    nextRunAt,
  ]);
}

/** The sentinel a claim writes before the next fire is known. */
const CLAIMED = -1;

/**
 * Claim one due fire by moving its stored time to the sentinel.
 *
 * The next fire is computed AFTER the claim, from the winner's clock, so a
 * server that was down for three intervals does not replay all three. The
 * sentinel is also the crash recovery: a process that dies between the claim
 * and the write leaves `-1`, which is due on the next boot.
 *
 * `absent` means no row exists (a plugin loaded before this table, or a test
 * double): the caller runs the job and inserts the row. `lost` means another
 * instance already moved it, so this tick must not run it.
 */
export async function claimPluginSchedule(
  db: DbClient,
  pluginId: string,
  id: string,
  dueAt: number,
): Promise<'claimed' | 'lost' | 'absent'> {
  const updated = await db.run(
    'UPDATE plugin_schedules SET next_run_at = ? WHERE plugin_id = ? AND id = ? AND next_run_at IS ?',
    [CLAIMED, pluginId, id, dueAt],
  );
  if (updated.changes > 0) return 'claimed';
  const row = await db.get<{ next_run_at: number | null }>(
    'SELECT next_run_at FROM plugin_schedules WHERE plugin_id = ? AND id = ?',
    [pluginId, id],
  );
  return row ? 'lost' : 'absent';
}

/** Write the fire a claimed schedule resolved to. */
export async function setPluginScheduleNext(
  db: DbClient,
  pluginId: string,
  id: string,
  nextRunAt: number | null,
): Promise<void> {
  await db.run('UPDATE plugin_schedules SET next_run_at = ? WHERE plugin_id = ? AND id = ?', [
    nextRunAt,
    pluginId,
    id,
  ]);
}

/** The stored fire, or undefined when the row is gone. */
export async function readPluginScheduleNext(
  db: DbClient,
  pluginId: string,
  id: string,
): Promise<number | null | undefined> {
  const row = await db.get<{ next_run_at: number | null }>(
    'SELECT next_run_at FROM plugin_schedules WHERE plugin_id = ? AND id = ?',
    [pluginId, id],
  );
  return row ? row.next_run_at : undefined;
}
