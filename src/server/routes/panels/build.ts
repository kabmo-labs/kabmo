/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `POST /api/panels/build` — run a plugin's build.
 *
 * A plugin is a Bun package, so its panels are served from a build output. That
 * makes "the manifest is valid but the build has not run" a real state a user can
 * be in — a fresh clone, an interrupted install, a source edit — and this is the
 * one action that resolves it without re-installing.
 *
 * The plugin is named by its id, which the scan resolves to a directory; a
 * caller never supplies a path, so this cannot be pointed at an arbitrary
 * package. Answers with the whole payload, like the install route, so the pane
 * shows the post-build state rather than a guess.
 */

import { json, type ActionFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { join } from 'path';
import {
  discoverPanelPlugins,
  getMarketplacePluginsDir,
  invalidatePanelScan,
} from '@/server/lib/panels/registry.server';
import { readPluginManifest } from '@/server/lib/panels/files.server';
import { buildPanelPlugin } from '@/server/lib/panels/build.server';
import { toManifest } from '@/server/lib/panels/manifest';

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') return methodNotAllowed({ request, params: {} });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const pluginId = typeof body.pluginId === 'string' ? body.pluginId.trim() : '';
  if (!pluginId) return json({ error: 'A plugin id is required.' }, { status: 400 });

  // Resolved against the scan, not the request: an id that is not installed
  // cannot name a directory.
  const { plugins } = await discoverPanelPlugins();
  const installed = plugins.find((plugin) => plugin.pluginId === pluginId);
  if (!installed) return json({ error: `No installed plugin with id "${pluginId}".` }, { status: 404 });
  if (!installed.isPackage) {
    return json({ error: `${pluginId} is not a Bun package, so it has nothing to build.` }, { status: 400 });
  }

  const root = join(getMarketplacePluginsDir(), pluginId);
  const read = await readPluginManifest(root);
  if (read.kind !== 'manifest') {
    return json({ error: read.kind === 'error' ? read.reason : 'no manifest found' }, { status: 400 });
  }
  const manifest = toManifest(read.value, root);
  if ('error' in manifest) return json({ error: manifest.error }, { status: 400 });

  const result = await buildPanelPlugin(root, manifest);
  invalidatePanelScan();

  if (result.status !== 'built') {
    return json(
      { error: result.reason ?? 'the build failed', ...(await discoverPanelPlugins()) },
      { status: 400 },
    );
  }
  return json({ ok: true, ...(await discoverPanelPlugins()) });
}
