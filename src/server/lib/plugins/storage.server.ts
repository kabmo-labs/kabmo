/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A plugin's key/value and record storage, namespaced by plugin id.
 *
 * The `plugin_id` in every statement is bound by THIS module from the id the
 * host passed at load, never from an argument a plugin supplies. That is the
 * whole enforcement: a plugin holds no string it could point at another
 * plugin's rows, so "namespacing" is a property of the call signature rather
 * than a check that could be forgotten at one of the six call sites.
 *
 * Values are stored as JSON text. A value that cannot be serialized is refused
 * at the boundary rather than written as `undefined` — a silent `null` in the
 * database is indistinguishable from a plugin that deliberately wrote null.
 */

import { getDb } from '@/server/db.server';
import type { DbClient } from '@/server/lib/db/client';
import type { PluginJson, PluginKvStorage, PluginRecordStorage } from '@kabmo-labs/plugin-sdk';

/**
 * Serialize a value, refusing what JSON cannot carry.
 *
 * `JSON.stringify` answers `undefined` for a function or a symbol and drops a
 * `Map`/`Date` into `{}` — both of which would land in the database as a value
 * the plugin did not write. The throw names the key, because the alternative is
 * a read that comes back empty with nothing to explain it.
 */
function serialize(what: string, value: unknown): string {
  const text = JSON.stringify(value);
  if (text === undefined) throw new Error(`${what} is not JSON-serializable`);
  return text;
}

function parse<T>(text: string, what: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${what} holds invalid JSON — written by a previous version of this plugin?`);
  }
}

/** Test seam: build the two storages against a given client. */
export function createPluginStorage(db: DbClient, pluginId: string) {
  const now = () => Date.now();

  const kv: PluginKvStorage = {
    async read<T = PluginJson>(key: string) {
      const row = await db.get<{ value: string }>(
        'SELECT value FROM plugin_kv WHERE plugin_id = ? AND key = ?',
        [pluginId, key],
      );
      return row ? parse<T>(row.value, `kv "${key}"`) : undefined;
    },
    async write(key, value) {
      await db.run(
        'INSERT OR REPLACE INTO plugin_kv (plugin_id, key, value, updated_at) VALUES (?, ?, ?, ?)',
        [pluginId, key, serialize(`kv "${key}"`, value), now()],
      );
    },
    async remove(key) {
      await db.run('DELETE FROM plugin_kv WHERE plugin_id = ? AND key = ?', [pluginId, key]);
    },
    async keys() {
      const rows = await db.all<{ key: string }>(
        'SELECT key FROM plugin_kv WHERE plugin_id = ? ORDER BY key',
        [pluginId],
      );
      return rows.map((row) => row.key);
    },
  };

  const records: PluginRecordStorage = {
    async put(collection, id, data) {
      await db.run(
        'INSERT OR REPLACE INTO plugin_records (plugin_id, collection, id, data, updated_at) VALUES (?, ?, ?, ?, ?)',
        [pluginId, collection, id, serialize(`record "${collection}/${id}"`, data), now()],
      );
    },
    async get<T = PluginJson>(collection: string, id: string) {
      const row = await db.get<{ data: string }>(
        'SELECT data FROM plugin_records WHERE plugin_id = ? AND collection = ? AND id = ?',
        [pluginId, collection, id],
      );
      return row ? parse<T>(row.data, `record "${collection}/${id}"`) : undefined;
    },
    async list<T = PluginJson>(collection: string, options?: { limit?: number }) {
      // The limit is clamped rather than trusted: a plugin asking for a million
      // rows would block the synchronous driver for every other request.
      const limit = Math.min(Math.max(options?.limit ?? 200, 1), 1000);
      const rows = await db.all<{ id: string; data: string }>(
        'SELECT id, data FROM plugin_records WHERE plugin_id = ? AND collection = ? ORDER BY updated_at DESC LIMIT ?',
        [pluginId, collection, limit],
      );
      return rows.map((row) => ({ id: row.id, data: parse<T>(row.data, `record "${collection}/${row.id}"`) }));
    },
    async remove(collection, id) {
      await db.run('DELETE FROM plugin_records WHERE plugin_id = ? AND collection = ? AND id = ?', [
        pluginId,
        collection,
        id,
      ]);
    },
    async clear(collection) {
      await db.run('DELETE FROM plugin_records WHERE plugin_id = ? AND collection = ?', [pluginId, collection]);
    },
  };

  return { kv, records };
}

/** The same pair against the live database, for a plugin being loaded. */
export async function pluginStorageFor(pluginId: string) {
  return createPluginStorage(await getDb(), pluginId);
}
