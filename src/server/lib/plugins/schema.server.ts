/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The plugin platform's own tables.
 *
 * Three tables, one per axis of state a plugin's server half owns, and all
 * three are keyed by `plugin_id` FIRST. That is the enforcement, not a
 * convention: the host binds every storage call to the plugin's own id before
 * it reaches SQL, so a plugin cannot name another's namespace because it is
 * never given the string. Two plugins using the key `notes` are two rows.
 *
 * One shared table per axis rather than a table per plugin. A plugin-declared
 * schema would mean DDL driven by a third-party manifest — a migration the
 * Kabmo cannot version, and a table namespace two plugins could collide in.
 * `collection` and `id` inside `plugin_records` give the same expressiveness
 * with one migration and a composite primary key that is already an index.
 *
 * Kept out of `db.server.ts`'s bootstrap block for the same reason
 * `btw/schema.server.ts` and `schedule/schema.server.ts` are: called once per
 * database open, owned by the feature that reads it.
 */

import type { DbClient } from '@/server/lib/db/client';

const PLUGIN_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS plugin_kv (
    plugin_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (plugin_id, key)
  );

  CREATE TABLE IF NOT EXISTS plugin_records (
    plugin_id TEXT NOT NULL,
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (plugin_id, collection, id)
  );
  CREATE INDEX IF NOT EXISTS idx_plugin_records_collection
    ON plugin_records (plugin_id, collection, updated_at DESC);

  CREATE TABLE IF NOT EXISTS plugin_settings (
    plugin_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (plugin_id, key)
  );
`;

/** Idempotent: the plugin platform's tables, created on every database open. */
export async function ensurePluginSchema(db: DbClient): Promise<void> {
  await db.exec(PLUGIN_SCHEMA_SQL);
}

/**
 * Drop every row a plugin owns.
 *
 * Called when a plugin is REMOVED (not when it is disabled — a disabled plugin
 * keeps its state, which is the whole difference between switching off and
 * deleting). Leaving the rows behind would make a reinstall inherit the
 * previous install's data, which reads as a plugin remembering something the
 * user never told it.
 */
export async function purgePluginState(db: DbClient, pluginId: string): Promise<void> {
  await db.run('DELETE FROM plugin_kv WHERE plugin_id = ?', [pluginId]);
  await db.run('DELETE FROM plugin_records WHERE plugin_id = ?', [pluginId]);
  await db.run('DELETE FROM plugin_settings WHERE plugin_id = ?', [pluginId]);
}
