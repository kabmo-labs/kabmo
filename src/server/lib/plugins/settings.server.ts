/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A plugin's declared settings: the values, the rules, and the change fan-out.
 *
 * The DEFINITIONS come from the plugin's manifest and the VALUES from
 * `plugin_settings`, both keyed by plugin id — so a plugin that is switched off
 * still shows its settings, and a value written by hand is still checked
 * against the rule the plugin declared. That is the reason the definitions are
 * declarative rather than a schema object the plugin hands over at load: a
 * switched-off plugin never runs, so anything it would have registered does not
 * exist.
 *
 * A secret's value never leaves this module in the direction of a client. The
 * reader that answers the settings UI reports presence, and the value is
 * readable only by the plugin that owns it — the same rule the omp plugin
 * settings pane follows for `omp-plugins.lock.json`.
 */

import { getDb } from '@/server/db.server';
import type { DbClient } from '@/server/lib/db/client';
import type { PluginSettingDefinition, PluginSettingsApi } from '@kabmo-labs/kabmo-sdk';

export type PluginSettingsValues = Record<string, string | number | boolean>;

type Listener = (values: PluginSettingsValues) => void;

/** One plugin's change fan-out, held process-wide so a reload keeps its readers. */
declare global {
  // eslint-disable-next-line no-var
  var __kabmoPluginSettingListeners: Map<string, Set<Listener>> | undefined;
}

function listenersFor(pluginId: string): Set<Listener> {
  const registry = (globalThis.__kabmoPluginSettingListeners ??= new Map());
  let set = registry.get(pluginId);
  if (!set) {
    set = new Set();
    registry.set(pluginId, set);
  }
  return set;
}

/** Drop every listener a plugin registered — called from its disposal pass. */
export function clearPluginSettingListeners(pluginId: string): void {
  globalThis.__kabmoPluginSettingListeners?.delete(pluginId);
}

/**
 * Coerce a stored string back to the type the definition declares.
 *
 * Values are stored as TEXT because the column is shared by three types and a
 * SQLite column has one affinity; the definition is what gives it meaning back.
 * A value that no longer parses answers the declared default, which is the
 * honest reading of "the definition changed under a stored value".
 */
function coerce(definition: PluginSettingDefinition, raw: string): string | number | boolean {
  if (definition.type === 'boolean') return raw === 'true';
  if (definition.type === 'number') {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : typeof definition.default === 'number' ? definition.default : 0;
  }
  return raw;
}

/**
 * Validate a value against its definition.
 *
 * Refuses rather than coerces: a number written as `"abc"` would be stored as
 * the definition's default, so the user's write would appear to succeed and
 * change nothing.
 */
export function validateSettingValue(
  definition: PluginSettingDefinition,
  value: unknown,
): { ok: true; stored: string } | { ok: false; error: string } {
  if (definition.type === 'boolean') {
    if (typeof value !== 'boolean') return { ok: false, error: 'expected a boolean' };
    return { ok: true, stored: String(value) };
  }
  if (definition.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return { ok: false, error: 'expected a finite number' };
    return { ok: true, stored: String(value) };
  }
  if (typeof value !== 'string') return { ok: false, error: 'expected a string' };
  return { ok: true, stored: value };
}

/** Every value, defaults filled in for keys never written. */
export async function readPluginSettings(
  db: DbClient,
  pluginId: string,
  definitions: Record<string, PluginSettingDefinition>,
): Promise<PluginSettingsValues> {
  const rows = await db.all<{ key: string; value: string }>(
    'SELECT key, value FROM plugin_settings WHERE plugin_id = ?',
    [pluginId],
  );
  const stored = new Map(rows.map((row) => [row.key, row.value]));
  const values: PluginSettingsValues = {};
  for (const [key, definition] of Object.entries(definitions)) {
    const raw = stored.get(key);
    if (raw !== undefined) values[key] = coerce(definition, raw);
    else if (definition.default !== undefined) values[key] = definition.default;
  }
  return values;
}

/**
 * The values as the settings UI may see them: a secret's value is replaced by
 * a marker, so a browser surface can never read back a credential.
 */
export function maskSecrets(
  values: PluginSettingsValues,
  definitions: Record<string, PluginSettingDefinition>,
): PluginSettingsValues {
  const out: PluginSettingsValues = {};
  for (const [key, value] of Object.entries(values)) {
    out[key] = definitions[key]?.secret ? '••••••••' : value;
  }
  return out;
}

/** Build the API one plugin is handed at load. */
export function createPluginSettings(
  db: DbClient,
  pluginId: string,
  definitions: Record<string, PluginSettingDefinition>,
): PluginSettingsApi {
  const read = () => readPluginSettings(db, pluginId, definitions);
  return {
    read,
    async readOne<T extends string | number | boolean>(key: string) {
      return (await read())[key] as T | undefined;
    },
    async write(key, value) {
      const definition = definitions[key];
      if (!definition) throw new Error(`"${key}" is not a declared setting of this plugin`);
      const checked = validateSettingValue(definition, value);
      if (!checked.ok) throw new Error(`setting "${key}": ${checked.error}`);
      await db.run(
        'INSERT OR REPLACE INTO plugin_settings (plugin_id, key, value, updated_at) VALUES (?, ?, ?, ?)',
        [pluginId, key, checked.stored, Date.now()],
      );
      const next = await read();
      for (const listener of [...listenersFor(pluginId)]) {
        try {
          listener(next);
        } catch {
          // A throwing listener must not break the write it is reporting on —
          // the same rule the realtime signal bus follows.
        }
      }
    },
    subscribe(listener) {
      const set = listenersFor(pluginId);
      set.add(listener);
      return () => set.delete(listener);
    },
  };
}

/** The live pair, for a plugin being loaded. */
export async function pluginSettingsFor(
  pluginId: string,
  definitions: Record<string, PluginSettingDefinition>,
): Promise<PluginSettingsApi> {
  return createPluginSettings(await getDb(), pluginId, definitions);
}
