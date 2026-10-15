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
import { probeGitUpdate, updateGitPlugin } from '@/server/lib/panels/git-update.server';
import { forceSyncBundledPlugin } from '@/server/lib/panels/sync.server';
import { writeGitStatus } from '@/server/lib/panels/git-status.server';
import { forgetCatalogEntry } from '@/server/lib/panels/catalog.server';
import { setPluginAutoUpdate, setPluginEnabled } from '@/server/lib/panels/state.server';
import { disposePlugin, loadPluginServer, notePluginLoadFailure } from '@/server/lib/plugins/loader.server';
import { emitRealtimeSignal } from '@/server/lib/realtime/signals.server';

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

  if (type === 'update_git') {
    const pluginId = typeof body.pluginId === 'string' ? body.pluginId.trim() : '';
    if (!pluginId) return json({ error: 'A plugin id is required.' }, { status: 400 });

    // Unload BEFORE the files move, for the same reason a removal does: the
    // module is already imported and its registrations are live, so a server
    // half that kept running would answer from code the directory no longer
    // holds. Reloaded below, after the update.
    await syncPluginServer(pluginId, false);
    const result = await updateGitPlugin(pluginId);
    if (!result.ok) {
      // The plugin is still installed and still on its previous commit — the
      // refusal is about what an update WOULD do. Its server half goes back up
      // either way, or a failed update would leave a working plugin inert.
      await syncPluginServer(pluginId, true);
      return json({ error: result.error, ...(await discoverPanelPlugins()) }, { status: 400 });
    }
    await syncPluginServer(pluginId, true);
    // The freshness this update just achieved is written rather than probed
    // again: the commit is known, and a second round trip could only disagree
    // with the reset that already happened.
    writeGitStatus(pluginId, {
      current: result.commit ?? null,
      latest: result.commit ?? null,
      updateAvailable: false,
      checkedAt: Date.now(),
    });
    // The statuses and the rebuilt bundle both travel on the scan payload, and
    // the server-half reload above may have scanned in between — so the cache is
    // dropped once more here, right before the read that answers the caller, and
    // the topic is republished for the same reason `check_updates` does it: a
    // stale topic snapshot wins over the response on the client.
    invalidatePanelScan();
    emitRealtimeSignal('panels-changed');
    const payload = await discoverPanelPlugins();
    if (result.warning) return json({ ok: true, error: result.warning, ...payload });
    return json({ ok: true, updated: result.updated, ...payload });
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
