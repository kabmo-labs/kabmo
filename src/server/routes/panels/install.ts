/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `POST /api/panels/install` — install a panel plugin, remove one, or switch
 * one on or off.
 *
 * Every verb answers with the WHOLE panel payload rather than just a status: a
 * mutation changes the catalog, the panel list, the rejections and the
 * enablement state at once, and a caller that had to re-read would be able to
 * show a state the server never had.
 *
 * `install` takes EITHER a `url` (a git clone) or a `pluginId` from the bundled
 * marketplace (a copy of the plugin the package ships). Both converge on one
 * staged install, so a bundled plugin and a cloned one are indistinguishable
 * afterwards — same directory shape, same catalog entry, same build step.
 *
 * `enable`/`disable` only flip a flag: the plugin's files stay on disk, which is
 * what makes disabling reversible and different from `remove`.
 */

import { json, type ActionFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { discoverPanelPlugins, invalidatePanelScan } from '@/server/lib/panels/registry.server';
import { installPanelPluginFromBundled, installPanelPluginFromGit, removePanelPlugin } from '@/server/lib/panels/install.server';
import { forgetCatalogEntry } from '@/server/lib/panels/catalog.server';
import { setPluginEnabled } from '@/server/lib/panels/state.server';
import { disposePlugin, loadPluginServer, notePluginLoadFailure } from '@/server/lib/plugins/loader.server';

/**
 * Bring a plugin's SERVER half in line with its on-disk state, now.
 *
 * The server half is otherwise loaded once at boot (`loadPluginServers` in the
 * entry), so installing or switching a plugin on used to leave its routes, RPC
 * methods and realtime topic unregistered until the process restarted — a panel
 * that installed cleanly and then answered "no plugin is loaded", or a Stats
 * panel stuck on "No sample yet." with nothing on screen to explain it.
 *
 * Never throws: a plugin whose server half cannot load is a plugin whose PANEL
 * still works, and the failure is recorded through `notePluginLoadFailure` —
 * the same list `GET /api/plugins/state` serves to the pane — so the reader
 * sees WHY. Folding it into a 400 here would hide a successful install behind
 * an unrelated fault.
 */
async function syncPluginServer(pluginId: string, enabled: boolean): Promise<void> {
  try {
    if (enabled) {
      await loadPluginServer(pluginId);
      // A later success clears an earlier failure, or the pane would keep
      // reporting a fault the user has already fixed.
      notePluginLoadFailure(pluginId, null);
      return;
    }
    await disposePlugin(pluginId);
    notePluginLoadFailure(pluginId, null);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    notePluginLoadFailure(pluginId, reason);
    console.error(`[plugins] ${pluginId}: server half ${enabled ? 'load' : 'unload'} failed — ${reason}`);
  }
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') return methodNotAllowed({ request, params: {} });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const type = typeof body.type === 'string' ? body.type : '';

  if (type === 'install') {
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    const pluginId = typeof body.pluginId === 'string' ? body.pluginId.trim() : '';
    if (!url && !pluginId) return json({ error: 'A git URL or a bundled plugin id is required.' }, { status: 400 });

    const result = url ? await installPanelPluginFromGit(url) : await installPanelPluginFromBundled(pluginId);
    // A partial success (installed on disk, catalog entry failed) still answers
    // 200 with the whole payload — the plugin IS there, and the payload's own
    // errors list carries what went wrong with the catalog.
    if (!result.ok) return json({ error: result.error, ...(await discoverPanelPlugins()) }, { status: 400 });
    // The files are on disk; make them live before answering, so the panel the
    // user opens next is the one that was just installed.
    if (result.pluginId) await syncPluginServer(result.pluginId, true);
    return json({ ok: true, pluginId: result.pluginId, ...(await discoverPanelPlugins()) });
  }

  if (type === 'remove') {
    const pluginId = typeof body.pluginId === 'string' ? body.pluginId.trim() : '';
    if (!pluginId) return json({ error: 'A plugin id is required.' }, { status: 400 });
    // Unload BEFORE the files go: the module is already imported and its
    // registrations are live, and a disposer that reads its own bundle would
    // otherwise race the removal.
    await syncPluginServer(pluginId, false);
    const result = await removePanelPlugin(pluginId);
    // A removed plugin's disabled flag would otherwise outlive it and switch off
    // a future reinstall of the same id.
    if (result.ok) await setPluginEnabled(pluginId, true);
    if (!result.ok) return json({ error: result.error, ...(await discoverPanelPlugins()) }, { status: 400 });
    // The directory is gone, so the removal succeeded — but a catalog that could
    // not be pruned leaves the dangling entry the scan reports, and that is
    // exactly the row this action was meant to clear. It travels on the payload
    // rather than only in the log, because the alternative is the pane showing
    // "Rejected" over the user's own successful action with no explanation.
    const payload = await discoverPanelPlugins();
    if (result.error) return json({ ok: true, error: result.error, ...payload });
    return json({ ok: true, ...payload });
  }

  if (type === 'forget') {
    // The catalog entry is addressed by its SOURCE, not by a plugin id: the
    // directory it names is gone, so there is no manifest to read an id from —
    // and the row the user clicked came from a catalog entry, whose key is the
    // source path.
    const source = typeof body.source === 'string' ? body.source.trim() : '';
    if (!source) return json({ error: 'A catalog source is required.' }, { status: 400 });
    const result = await forgetCatalogEntry(source);
    if (!result.ok) return json({ error: result.error, ...(await discoverPanelPlugins()) }, { status: 400 });
    return json({ ok: true, ...(await discoverPanelPlugins()) });
  }

  if (type === 'enable' || type === 'disable') {
    const pluginId = typeof body.pluginId === 'string' ? body.pluginId.trim() : '';
    if (!pluginId) return json({ error: 'A plugin id is required.' }, { status: 400 });
    const enabled = type === 'enable';
    await setPluginEnabled(pluginId, enabled);
    // The scan publishes a plugin's panels only while it is on, so the cached
    // scan is stale the moment the flag moves.
    invalidatePanelScan();
    // Enablement gates the server half too: a disabled plugin must stop
    // answering its routes and RPC methods, and a re-enabled one must resume.
    await syncPluginServer(pluginId, enabled);
    return json({ ok: true, ...(await discoverPanelPlugins()) });
  }

  return json({ error: `Unknown action: ${type || '(none)'}` }, { status: 400 });
}
