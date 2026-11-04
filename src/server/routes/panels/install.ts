/**
 * @license
 * SPDX-License-Identifier: MIT
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
 *
 * `update` and `update_all` are the pane's Update buttons. Both go through
 * `update.server.ts`, which dispatches on the install's SOURCE — a git clone is
 * fetched and reset to its remote, a bundled install takes the store's copy
 * under the sync's own edit gate — so one button means one thing to the reader
 * whatever the plugin's origin.
 */

import { json, type ActionFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { discoverPanelPlugins, invalidatePanelScan } from '@/server/lib/panels/registry.server';
import { installPanelPluginFromBundled, installPanelPluginFromGit, removePanelPlugin } from '@/server/lib/panels/install.server';
import { probeGitUpdate } from '@/server/lib/panels/git-update.server';
import { updateAllPanelPlugins, updatePanelPlugin } from '@/server/lib/panels/update.server';
import { forceSyncBundledPlugin } from '@/server/lib/panels/sync.server';
import { writeGitStatus } from '@/server/lib/panels/git-status.server';
import { forgetCatalogEntry } from '@/server/lib/panels/catalog.server';
import { setPluginAutoUpdate, setPluginEnabled } from '@/server/lib/panels/state.server';
import { syncPluginServer } from '@/server/lib/plugins/server-half.server';
import { emitRealtimeSignal } from '@/server/lib/realtime/signals.server';

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

  if (type === 'check_updates') {
    // Probes run for EVERY git-installed plugin, sequentially: the probe is a
    // network round trip, and a fan-out of one process per plugin would burst
    // the same remote — which some hosts answer with a rate limit that then
    // reports itself as "unreachable". The answer is the whole payload, so the
    // freshness badges and the rows that carry them land together.
    const { plugins } = await discoverPanelPlugins();
    for (const plugin of plugins) {
      if (!plugin.gitOrigin) continue;
      writeGitStatus(plugin.pluginId, await probeGitUpdate(plugin.pluginId));
    }
    // The statuses travel ON the scan payload, so the cached scan still holds
    // the previous (or empty) map. Without this the response would report every
    // plugin as never probed for up to the cache's five seconds.
    invalidatePanelScan();
    // The topic must be republished, not only the response seeded: the client
    // reads `topic.data ?? host.payload`, so a stale topic snapshot WINS over
    // the fresh response and the row keeps rendering the old status. Measured in
    // the browser: the freshness row stayed "not checked" after a check that had
    // succeeded server-side.
    emitRealtimeSignal('panels-changed');
    return json({ ok: true, ...(await discoverPanelPlugins()) });
  }

  if (type === 'update') {
    const pluginId = typeof body.pluginId === 'string' ? body.pluginId.trim() : '';
    if (!pluginId) return json({ error: 'A plugin id is required.' }, { status: 400 });

    // One button for both sources: a git clone is fetched and reset, a bundled
    // install takes the store's copy under the sync's own edit gate. The
    // unload/reload around the files and the freshness write live in
    // `updatePanelPlugin`, so this branch only translates the outcome.
    const result = await updatePanelPlugin(pluginId);
    // The scan holds what either update moved — files, versions, the refusal
    // record — and a stale topic snapshot WINS over the response on the client,
    // so the topic is republished rather than only answered.
    invalidatePanelScan();
    emitRealtimeSignal('panels-changed');
    const payload = await discoverPanelPlugins();
    if (result.error) return json({ error: result.error, ...payload }, { status: 400 });
    if (result.warning) return json({ ok: true, error: result.warning, ...payload });
    return json({ ok: true, updated: result.updated, ...payload });
  }

  if (type === 'update_all') {
    const result = await updateAllPanelPlugins();
    invalidatePanelScan();
    emitRealtimeSignal('panels-changed');
    const payload = await discoverPanelPlugins();
    // A refusal is answered 200 where the pass ALSO updated something: one
    // plugin with local edits must not hide the others' success. The reasons
    // travel in `error` (the pane's warning banner) and, for a blocked bundled
    // copy, in `syncBlocked` beside it.
    const notes = [
      ...result.refused.map((entry) => entry.error),
      ...result.warnings.map((entry) => `${entry.pluginId}: ${entry.warning}`),
    ];
    if (notes.length > 0) return json({ ok: true, error: notes.join(' · '), ...payload });
    return json({ ok: true, ...payload });
  }

  if (type === 'force_sync') {
    // The escape hatch for a blocked bundled sync: the user has seen which files
    // differ and asked for the store's copy anyway. Answered with the whole
    // payload, and the scan is invalidated because the plugin's files and its
    // refusal record both moved.
    const pluginId = typeof body.pluginId === 'string' ? body.pluginId.trim() : '';
    if (!pluginId) return json({ error: 'A plugin id is required.' }, { status: 400 });
    await syncPluginServer(pluginId, false);
    const result = await forceSyncBundledPlugin(pluginId);
    if (!result.ok) {
      await syncPluginServer(pluginId, true);
      invalidatePanelScan();
      return json({ error: result.error, ...(await discoverPanelPlugins()) }, { status: 400 });
    }
    await syncPluginServer(pluginId, true);
    invalidatePanelScan();
    emitRealtimeSignal('panels-changed');
    const payload = await discoverPanelPlugins();
    if (result.warning) return json({ ok: true, error: result.warning, ...payload });
    return json({ ok: true, ...payload });
  }

  if (type === 'set_auto_update') {
    const enabled = body.enabled === true;
    // `setPluginAutoUpdate` republishes the topic itself (the one writer of that
    // state owns the signal), so only the scan cache is dropped here.
    await setPluginAutoUpdate(enabled);
    invalidatePanelScan();
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
