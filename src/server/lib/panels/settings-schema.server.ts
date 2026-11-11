/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A plugin's declared settings, read from its `settings-schema.json`.
 *
 * The schema is a FILE rather than a key in the manifest because it is the
 * plugin's whole configuration contract: a form the host renders, the rules the
 * host validates a write against, and the defaults a switched-off plugin still
 * reports. Keeping it beside the manifest means a plugin can ship settings
 * without a manifest edit, and a reader can find the contract without knowing
 * which of the two manifest spellings (`kabmo.json` or `package.json`'s `kabmo`
 * key) the plugin used.
 *
 * The file is OPTIONAL. A plugin with no settings ships no file, and the host
 * draws no settings button — "no settings" and "settings that failed to parse"
 * must not look alike, which is why an unreadable or invalid file is an error
 * rather than an empty form.
 *
 * The manifest's inline `settings` key is still read when the file is absent:
 * plugins written before the file existed keep their form, and the file wins
 * when both are present so there is one answer per plugin.
 */

import { join } from 'path';
import type { PanelPluginManifest } from '@/shared/types';
import type { PluginSettingDefinition } from '@kabmo-labs/kabmo-sdk';
import { readJsonBody, readPluginManifest } from '@/server/lib/panels/files.server';
import { toManifest, toSettingsSchema } from '@/server/lib/panels/manifest';

/** The file a plugin ships to declare its settings. */
export const SETTINGS_SCHEMA_FILE = 'settings-schema.json';

export type SettingsSchemaRead =
  | { kind: 'none' }
  | { kind: 'error'; reason: string }
  | { kind: 'schema'; value: Record<string, PluginSettingDefinition> };

/** Read and validate `settings-schema.json` from a plugin directory. */
export async function readSettingsSchemaFile(dir: string): Promise<SettingsSchemaRead> {
  const read = await readJsonBody(join(dir, SETTINGS_SCHEMA_FILE));
  if (read.kind === 'none') return { kind: 'none' };
  if (read.kind === 'unreadable') return { kind: 'error', reason: `${SETTINGS_SCHEMA_FILE} is not valid JSON` };
  const parsed = toSettingsSchema(read.value);
  if ('error' in parsed) return { kind: 'error', reason: parsed.error };
  return { kind: 'schema', value: parsed.value };
}

/**
 * The definitions a plugin's settings form and API use.
 *
 * `manifest` is passed by a caller that already parsed it (the loader and the
 * scan), so the file is read once per plugin rather than once per consumer.
 */
export async function pluginSettingsDefinitions(
  dir: string,
  manifest?: PanelPluginManifest,
): Promise<{ definitions: Record<string, PluginSettingDefinition> } | { error: string }> {
  const schema = await readSettingsSchemaFile(dir);
  if (schema.kind === 'error') return { error: schema.reason };
  if (schema.kind === 'schema') return { definitions: schema.value };

  if (manifest) return { definitions: manifest.settings ?? {} };

  const read = await readPluginManifest(dir);
  if (read.kind !== 'manifest') return { definitions: {} };
  const parsed = toManifest(read.value, dir);
  if ('error' in parsed) return { definitions: {} };
  return { definitions: parsed.settings ?? {} };
}
