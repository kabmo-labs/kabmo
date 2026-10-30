/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Everything the server starts AFTER its listener is accepting requests.
 *
 * Split out of `index.ts` so the entry file stays a readable boot script: the
 * ordering rules below are the whole content of this module, and they are the
 * part a reader needs to see in one place.
 *
 * The order is not cosmetic. Each clock starts once the thing it reads exists:
 * the scheduled-task and waiting-prompt runtimes after the watchers (their first
 * sweep may spawn an omp child), the bundled plugin sync before the server
 * halves are imported (a half is `import()`ed from its BUILT bundle, so the copy
 * on disk at that moment is the code this process runs until it restarts), and
 * the tray last because its config carries the URL the listener now serves.
 */

import { getDb } from '@/server/db.server';
import { compactChatOverlayRows } from '@/server/lib/db/compact-chat-overlay';
import { packageDir } from '@/server/lib/fs/package-root';
import { isTrayEnabledByArgv } from '@/server/lib/lifecycle/argv-flags';
import { installMemoryMaintenance, stopMemoryMaintenance } from '@/server/lib/lifecycle/memory';
import { syncDiscoveryRootsWatch, stopDiscoveryRootsWatch } from '@/server/lib/omp/config/roots-watch.server';
import { startPanelAutoUpdate } from '@/server/lib/panels/auto-update.server';
import { syncBundledPlugins } from '@/server/lib/panels/sync.server';
import { disposeAllPluginsOnShutdown, loadPluginServers } from '@/server/lib/plugins/loader.server';
import { startScheduleRuntime, stopScheduleRuntime } from '@/server/lib/schedule/runtime.server';
import { ensureTray } from '@/server/lib/tray/runtime.server';
import { startWaitingRuntime, stopWaitingRuntime } from '@/server/lib/waiting/runtime.server';

/** What the tray needs from the listener that is already up. */
export interface AfterListenTarget {
  port: number;
  host: string;
  tls: boolean;
}

/**
 * Start every post-listen clock, in the order their inputs appear.
 *
 * Never throws: each step reports its own failure and the server keeps serving.
 */
export async function runAfterListenTasks(target: AfterListenTarget): Promise<void> {
  await compactChatOverlay();
  await watchDiscoveryRoots();

  // The scheduled-task clock. Started after the listener is up and the watchers
  // are attached, so a task that fires early cannot race the schema or the
  // discovery roots; the runtime's own first tick is delayed for the same
  // reason. Idempotent, and anchored on `globalThis` — a `bun --hot` reload must
  // not leave a second interval running.
  startScheduleRuntime();

  // The waiting-prompt clock: a prompt held until another session finishes.
  // Same shape and placement — its first sweep may spawn an omp child.
  startWaitingRuntime();

  await syncBundledPluginsAndReport();
  await loadPluginServerHalves();
  startPanelAutoUpdate();
  startTray(target);

  // A full collection past the ceiling, never a schedule (`lifecycle/memory.ts`).
  installMemoryMaintenance();
}

/**
 * Stop every clock this module started, and the listener, then exit.
 *
 * `stopListener` is passed in because the Elysia app belongs to the entry file;
 * this only owns the order and the await-before-exit rule.
 */
export function installShutdownHandlers(stopListener: () => void | Promise<void>): void {
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      stopDiscoveryRootsWatch();
      stopMemoryMaintenance();
      stopScheduleRuntime();
      stopWaitingRuntime();
      void stopListener();
      // Plugins own children and listeners nothing else releases, and a detached
      // child outlives its parent — so this is awaited BEFORE the exit. It is
      // bounded internally, so a plugin that hangs cannot hold the port.
      void disposeAllPluginsOnShutdown().finally(() => process.exit(0));
    });
  }
}

/**
 * One-time rewrite of the overlay rows written before
 * `overlayRowsForOmpSession` existed. Deliberately HERE and NOT inside `getDb()`:
 * the test suite reaches `getDb()` in real mode, and opening a database must not
 * launch a rewrite of every mirrored conversation (measured: a `bun test` run
 * compacted a live one). Marker-keyed, so from the second start it is one
 * indexed SELECT.
 */
async function compactChatOverlay(): Promise<void> {
  try {
    await compactChatOverlayRows(await getDb());
  } catch (error) {
    console.error('[chat-overlay] compaction skipped:', error);
  }
}

/**
 * Watch the skill/command roots omp reads, so a SKILL.md written by anything
 * other than Kabmo (a hand edit, `git pull`, the skills CLI, another agent)
 * reaches the live sessions without a restart. See the module — the refresh
 * itself is `/reload-plugins`, this only decides when.
 */
async function watchDiscoveryRoots(): Promise<void> {
  try {
    await syncDiscoveryRootsWatch();
  } catch (error) {
    console.error('[discovery-watch] watcher setup skipped:', error);
  }
}

/**
 * Bring installed BUNDLED plugins up to the copy this package ships.
 *
 * A Kabmo update replaces the store and leaves the install — it is a copied
 * directory of ordinary files — so this is the only thing that notices. An
 * install Kabmo wrote is compared by CONTENT, so a shipped fix applies even when
 * its version did not move; a directory of unknown provenance keeps the version
 * gate, and git clones are skipped, so a plugin the user installed from a URL is
 * never overwritten by a store entry that happens to share its id.
 */
async function syncBundledPluginsAndReport(): Promise<void> {
  try {
    const synced = await syncBundledPlugins();
    for (const item of synced.updated) {
      // A content-only sync has no version to show, and printing `1.0.0 → 1.0.0`
      // would read as a no-op when a shipped fix actually landed.
      const span = item.contentOnly ? `${item.to} (content changed, version unchanged)` : `${item.from} → ${item.to}`;
      console.log(`[kabmo] plugins:        synced ${item.pluginId} ${span}`);
      if (item.warning) console.error(`[plugins] ${item.pluginId}: rebuild after sync failed — ${item.warning}`);
    }
    for (const failure of synced.failed) console.error(`[plugins] ${failure.pluginId}: bundled sync failed — ${failure.error}`);
  } catch (error) {
    console.error('[plugins] bundled sync skipped:', error);
  }
}

/**
 * The plugin platform's server half. After the listener is up, the scheduled-task
 * clock exists — a plugin's own schedules register with that runtime — and the
 * bundled sync ran, so the module imported here is the copy this package ships.
 * Never throws: one broken plugin must not stop the boot, and its reason is
 * reported here and by `GET /api/plugins`.
 */
async function loadPluginServerHalves(): Promise<void> {
  try {
    const result = await loadPluginServers();
    if (result.loaded.length > 0) {
      console.log(`[kabmo] plugins:        ${result.loaded.length} server half(s) loaded (${result.loaded.join(', ')})`);
    }
    for (const failure of result.errors) console.error(`[plugins] ${failure.pluginId}: ${failure.reason}`);
  } catch (error) {
    console.error('[plugins] server halves skipped:', error);
  }
}

/**
 * The tray icon, when `--tray` was passed (`serve --tray`, or the login entry the
 * CLI writes for `--startup`). After the listener is up, because the config
 * carries the URL the icon opens. Never throws: a machine with no tray client
 * (Linux without yad/zenity) reports why and keeps serving.
 */
function startTray(target: AfterListenTarget): void {
  if (!isTrayEnabledByArgv()) return;
  const result = ensureTray({ ...target, pkgRoot: packageDir() });
  if (result.started) console.log('[kabmo] tray:            icon shown');
  else console.log(`[kabmo] tray:            not shown — ${result.reason}`);
}
