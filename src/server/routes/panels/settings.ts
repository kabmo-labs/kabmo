/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A panel plugin's settings: its declared schema and the stored values.
 *
 * `GET` answers the form — every definition, with each stored secret replaced by
 * a marker — and `PUT` writes a whole form in one change. Both are addressed by
 * the plugin's manifest id rather than its directory: the pane knows the id, and
 * the directory is a server-side detail the registry resolves.
 *
 * The plugin does NOT have to be running. Settings are declared in
 * `settings-schema.json` and stored in `plugin_settings`, so a switched-off
 * plugin still shows and saves its configuration — the reason the scan keeps a
 * directory map for disabled installs at all.
 *
 * A plugin with no schema has nothing to answer: `GET` reports an empty
 * definition map (the pane then draws no button), and `PUT` refuses every key
 * because none is declared. Neither is an error — "no settings" is a normal
 * plugin, and the pane distinguishes it from a schema that failed to parse,
 * which the scan rejects at admission.
 */

import { getDb } from '@/server/db.server';
import { findInstalledPluginDir } from '@/server/lib/panels/registry.server';
import { pluginSettingsDefinitions } from '@/server/lib/panels/settings-schema.server';
import {
  maskSecrets,
  readPluginSettings,
  writePluginSettings,
} from '@/server/lib/plugins/settings.server';
import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowedResponse, parseJsonBody, requireParam } from '@/server/lib/route-adapter';
import { PLUGIN_SECRET_MASK } from '@/shared/lib/plugins/settings';
import { isRecord } from '@/shared/lib/util/guards';

const NO_STORE = { 'cache-control': 'no-store' } as const;

async function loadSettings(pluginId: string): Promise<Response> {
  const dir = await findInstalledPluginDir(pluginId);
  if (!dir) return json({ error: `no installed plugin with the id "${pluginId}"` }, { status: 404, headers: NO_STORE });

  const resolved = await pluginSettingsDefinitions(dir);
  if ('error' in resolved) return json({ error: resolved.error }, { status: 422, headers: NO_STORE });

  const db = await getDb();
  const values = await readPluginSettings(db, pluginId, resolved.definitions);
  return json(
    {
      pluginId,
      definitions: resolved.definitions,
      values: maskSecrets(values, resolved.definitions),
    },
    { headers: NO_STORE },
  );
}

export async function loader({ params }: LoaderFunctionArgs) {
  const pluginId = requireParam(params, 'plugin');
  if (!pluginId) return json({ error: 'the request did not name a plugin' }, { status: 400, headers: NO_STORE });
  return loadSettings(pluginId);
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'PUT') return methodNotAllowedResponse();

  const pluginId = requireParam(params, 'plugin');
  if (!pluginId) return json({ error: 'the request did not name a plugin' }, { status: 400, headers: NO_STORE });

  const dir = await findInstalledPluginDir(pluginId);
  if (!dir) return json({ error: `no installed plugin with the id "${pluginId}"` }, { status: 404, headers: NO_STORE });

  const resolved = await pluginSettingsDefinitions(dir);
  if ('error' in resolved) return json({ error: resolved.error }, { status: 422, headers: NO_STORE });

  const parsed = await parseJsonBody<{ values?: unknown }>(request);
  if (!parsed.ok) return json({ error: `the body is not JSON: ${parsed.error}` }, { status: 400, headers: NO_STORE });
  const raw = parsed.body?.values;
  if (!isRecord(raw)) {
    return json({ error: 'the body must carry a "values" object' }, { status: 400, headers: NO_STORE });
  }

  // A secret is sent back as the marker when the user did not touch the field.
  // Writing that marker would replace the credential with eight dots, so it is
  // dropped here — the field means "leave the stored value alone".
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (resolved.definitions[key]?.secret && value === PLUGIN_SECRET_MASK) continue;
    values[key] = value;
  }

  const db = await getDb();
  const written = await writePluginSettings(db, pluginId, resolved.definitions, values);
  if (!written.ok) return json({ error: written.error }, { status: 400, headers: NO_STORE });

  return json(
    {
      pluginId,
      definitions: resolved.definitions,
      values: maskSecrets(written.values, resolved.definitions),
    },
    { headers: NO_STORE },
  );
}
