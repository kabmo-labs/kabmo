/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Keeping an installed BUNDLED plugin in step with the copy the package ships.
 *
 * A bundled plugin is installed by COPYING the store's directory into the
 * working marketplace (`installPanelPluginFromBundled`), so an Kabmo update
 * that changes a bundled plugin's files changes the STORE and leaves the install
 * on the old copy. Nothing else would ever notice: the install is a directory of
 * ordinary files, and the scan has no notion of a store version.
 *
 * The sync runs at boot, after the listener is up, and it is VERSION-GATED — the
 * store copy is written over the install only when its manifest version is
 * strictly newer. That is what makes the pass safe to run unconditionally: a
 * user's plugin that happens to share an id with a store entry but was installed
 * from a git URL carries no `.git` ONLY if it was copied by hand, and a
 * hand-copied directory keeps working because its version is compared rather
 * than its provenance. A plugin installed from a git URL is skipped outright,
 * because the store's copy is not its source of truth.
 *
 * The install's `node_modules` and `dist` are left alone until the copy lands:
 * the sync copies the store's SOURCES, then rebuilds, exactly as an install
 * does. A build that fails leaves the new sources in place, which is the state
 * the pane's own Rebuild repairs.
 */

import { cp, rm } from 'fs/promises';
import { join } from 'path';
import { pathExists } from '@/server/lib/omp/core/paths';
import { isNewer } from '@/shared/lib/updates/semver';
import { getBundledMarketplaceDir, getMarketplacePluginsDir, invalidatePanelScan } from '@/server/lib/panels/registry.server';
import { readPluginManifest, subdirectories } from '@/server/lib/panels/files.server';
import { toManifest } from '@/server/lib/panels/manifest';
import { buildPanelPlugin } from '@/server/lib/panels/build.server';
import { readGitOrigin } from '@/server/lib/panels/git-clone.server';
import { changedPaths, hashTrackedFiles } from '@/server/lib/panels/local-edits.server';
import { readBaseline, clearBaseline, writeBaseline, writeBlockedSync } from '@/server/lib/panels/baseline.server';
import { emitRealtimeSignal } from '@/server/lib/realtime/signals.server';

export interface BundledSyncOutcome {
  pluginId: string;
  from: string;
  to: string;
  /** A rebuild that failed after the files were replaced. */
  warning?: string;
}

/** A sync that was REFUSED because the install's files had been edited. */
export interface BundledSyncBlocked {
  pluginId: string;
  from: string;
  to: string;
  changed: string[];
}

/** Read a directory's manifest version, or null when it has none to compare. */
async function manifestVersion(dir: string): Promise<string | null> {
  const read = await readPluginManifest(dir);
  if (read.kind !== 'manifest') return null;
  const manifest = toManifest(read.value, dir);
  return 'error' in manifest ? null : manifest.version;
}

/**
 * Replace an installed bundled plugin's tree with the store's copy.
 *
 * A MIRROR of the tracked surface, not a copy: a file the install has and the
 * store does not is REMOVED. Copying alone left it behind, so the install kept a
 * source file the store had dropped — and the edit gate then read that leftover
 * as a user edit on the next pass, blocking the plugin forever.
 *
 * The exclusions are the directories the plugin's own tooling owns.
 * `node_modules` is never refetched (a network round trip per plugin per chamber
 * upgrade, for a tree that usually did not change, and the build reinstalls when
 * the plugin declares dependencies at all). `dist` IS mirrored when the store
 * ships one — a plugin with no `src/` distributes its bundle, and keeping the
 * install's old output would serve the previous version's code beside a manifest
 * that says otherwise. When the store has no `dist`, nothing is removed and the
 * rebuild regenerates it from the new sources.
 */
async function replaceFromStore(source: string, destination: string): Promise<void> {
  const storeFiles = await hashTrackedFiles(source);
  const installFiles = await hashTrackedFiles(destination);
  for (const path of Object.keys(installFiles)) {
    if (path in storeFiles) continue;
    await rm(join(destination, path), { force: true });
  }

  const entries = await Array.fromAsync(new Bun.Glob('*').scan({ cwd: source, onlyFiles: false }));
  for (const name of entries) {
    if (name === 'node_modules' || name === '.git') continue;
    const to = join(destination, name);
    await rm(to, { recursive: true, force: true });
    await cp(join(source, name), to, { recursive: true, force: true });
  }
  invalidatePanelScan();
}

/**
 * Bring every installed bundled plugin up to the store's version.
 *
 * Never throws: one plugin that cannot be replaced must not stop the others, and
 * a failure is reported per plugin. Returns what actually moved.
 *
 * A plugin whose files were EDITED since they were written is refused rather than
 * replaced — see `local-edits.server.ts`. The refusal is recorded so the pane can
 * say why, and it is cleared on the next pass that finds the tree unchanged, so a
 * user who reverts their edit gets the update without doing anything else.
 */
export async function syncBundledPlugins(): Promise<{
  updated: BundledSyncOutcome[];
  blocked: BundledSyncBlocked[];
  failed: Array<{ pluginId: string; error: string }>;
}> {
  const updated: BundledSyncOutcome[] = [];
  const blocked: BundledSyncBlocked[] = [];
  const failed: Array<{ pluginId: string; error: string }> = [];
  const storeRoot = join(getBundledMarketplaceDir(), 'plugins');
  if (!(await pathExists(storeRoot))) return { updated, blocked, failed };
  const installedRoot = getMarketplacePluginsDir();

  for (const pluginId of await subdirectories(storeRoot)) {
    const destination = join(installedRoot, pluginId);
    if (!(await pathExists(destination))) continue;
    // A git-installed plugin is the user's own clone; the store's copy is not
    // its source of truth, whatever the id says.
    if (await readGitOrigin(destination)) continue;

    try {
      const storeVersion = await manifestVersion(join(storeRoot, pluginId));
      const installedVersion = await manifestVersion(destination);
      if (!storeVersion || !installedVersion || !isNewer(storeVersion, installedVersion)) {
        // Nothing to apply, so any earlier refusal no longer describes anything
        // the user has to act on.
        await writeBlockedSync(pluginId, null);
        continue;
      }

      // The baseline is taken when the install was WRITTEN, so a file that
      // differs from it is the user's. A plugin with no baseline predates this
      // check (or was installed by an older build), and running is the only
      // useful answer: refusing would freeze it forever with no way to say why.
      const baseline = await readBaseline(pluginId);
      if (baseline) {
        const changed = changedPaths(baseline, await hashTrackedFiles(destination));
        if (changed.length > 0) {
          blocked.push({ pluginId, from: installedVersion, to: storeVersion, changed });
          await writeBlockedSync(pluginId, { at: Date.now(), changed });
          continue;
        }
      }

      await replaceFromStore(join(storeRoot, pluginId), destination);

      const read = await readPluginManifest(destination);
      const manifest = read.kind === 'manifest' ? toManifest(read.value, destination) : null;
      if (!manifest || 'error' in manifest) {
        failed.push({ pluginId, error: 'the store copy has no valid manifest' });
        continue;
      }
      const build = await buildPanelPlugin(destination, manifest);
      invalidatePanelScan();
      // The new files are the baseline now — taken AFTER the build so the tree
      // the next pass compares against is the one this pass produced.
      await writeBaseline(pluginId, await hashTrackedFiles(destination));
      await writeBlockedSync(pluginId, null);
      updated.push({
        pluginId,
        from: installedVersion,
        to: storeVersion,
        ...(build.status === 'failed' ? { warning: build.reason ?? 'the plugin did not build' } : {}),
      });
    } catch (error) {
      failed.push({ pluginId, error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (updated.length > 0 || blocked.length > 0) emitRealtimeSignal('panels-changed');
  return { updated, blocked, failed };
}

/**
 * Sync ONE bundled plugin even though its files were edited.
 *
 * The escape hatch for a refusal: the user has seen which files differ and asked
 * for the store's copy anyway, which is the only way past a baseline the chamber
 * cannot reconcile. The baseline is dropped first, so the pass that follows takes
 * the store's files and re-records what it wrote — the same end state a clean
 * install reaches.
 *
 * Deliberately addressed by id and refusing anything that is not a bundled
 * install: this must never be a way to overwrite a git clone.
 */
export async function forceSyncBundledPlugin(pluginId: string): Promise<{ ok: boolean; error?: string; warning?: string }> {
  const storeDir = join(getBundledMarketplaceDir(), 'plugins', pluginId);
  const destination = join(getMarketplacePluginsDir(), pluginId);
  if (!(await pathExists(storeDir))) return { ok: false, error: `No bundled plugin with id "${pluginId}".` };
  if (!(await pathExists(destination))) return { ok: false, error: `${pluginId} is not installed.` };
  if (await readGitOrigin(destination)) return { ok: false, error: `${pluginId} is a git clone; its own Update is the way to change it.` };

  await clearBaseline(pluginId);
  await writeBlockedSync(pluginId, null);
  const result = await syncBundledPlugins();
  const failed = result.failed.find((entry) => entry.pluginId === pluginId);
  if (failed) return { ok: false, error: failed.error };
  const outcome = result.updated.find((entry) => entry.pluginId === pluginId);
  if (!outcome) return { ok: false, error: `${pluginId} is already at the store's version.` };
  return { ok: true, ...(outcome.warning ? { warning: outcome.warning } : {}) };
}
