/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Bringing one plugin's SERVER half in line with its on-disk state, now.
 *
 * The half is otherwise loaded once at boot (`loadPluginServers` in the entry),
 * so every action that moves a plugin's files or its enablement — install,
 * remove, enable, disable, update — has to load or unload it itself. Without
 * this the plugin's routes, RPC methods and realtime topic stay registered
 * against code the directory no longer holds: a panel that installed cleanly and
 * then answered "no plugin is loaded", or a Stats panel stuck on "No sample
 * yet." with nothing on screen to explain it.
 *
 * Never throws: a plugin whose server half cannot load is a plugin whose PANEL
 * still works, and the failure is recorded through `notePluginLoadFailure` — the
 * same list `GET /api/plugins/state` serves to the pane — so the reader sees
 * WHY. Folding it into a 4xx at the call site would hide a successful install
 * behind an unrelated fault.
 */

import { disposePlugin, loadPluginServer, notePluginLoadFailure } from '@/server/lib/plugins/loader.server';

export async function syncPluginServer(pluginId: string, enabled: boolean): Promise<void> {
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
