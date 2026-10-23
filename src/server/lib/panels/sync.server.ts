/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Keeping an installed BUNDLED plugin in step with the copy the package ships.
 *
 * A bundled plugin is installed by COPYING the store's directory into the
 * working marketplace (`installPanelPluginFromBundled`), so a Kabmo update
 * that changes a bundled plugin's files changes the STORE and leaves the install
 * on the old copy. Nothing else would ever notice: the install is a directory of
 * ordinary files, and the scan has no notion of a store version.
 *
 * The sync runs at boot, after the listener is up. For an install KABMO WROTE —
 * one carrying a baseline — the store's TREE is the gate, not its version: the
 * copy is written whenever the two tracked trees differ, in either direction.
 * A version gate cannot be the whole answer, and believing it was is what left
 * every bundled plugin un-updatable after the product rename: that release
 * rewrote the store's files and reset every bundled version to `0.0.1`, so the
 * store was never "newer" than the install and the pass skipped forever —
 * measured on a real install, where the only way to get the new code was to
 * remove the plugin and install it again. Content is also the honest test for a
 * shipped fix that forgot its bump.
 *
 * A directory with NO baseline is of unknown provenance (hand-copied, or
 * installed by a build that predates the baseline), so it keeps the conservative
 * version gate: a copy the user made themselves must not be replaced by a store
 * entry that merely shares its id. A git clone is skipped outright, because the
 * store's copy is not its source of truth.
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
import { baselineDescribesInstall, changedPaths, hashTrackedFiles, type TrackedFileHashes } from '@/server/lib/panels/local-edits.server';
import { readBaseline, writeBaseline, writeBlockedSync } from '@/server/lib/panels/baseline.server';
import { emitRealtimeSignal } from '@/server/lib/realtime/signals.server';

export interface BundledSyncOutcome {
  pluginId: string;
  from: string;
  to: string;
  /**
   * True when the store's files changed but its manifest version did not.
   *
   * The common case after a shipped fix whose bump was missed, and the reason
   * the gate is content: reporting it as `1.0.0 → 1.0.0` reads as a no-op.
   */
  contentOnly?: boolean;
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
 * `node_modules` is never refetched (a network round trip per plugin per Kabmo
 * upgrade, for a tree that usually did not change, and the build reinstalls when
 * the plugin declares dependencies at all). `dist` IS mirrored when the store
 * ships one — a plugin with no `src/` distributes its bundle, and keeping the
 * install's old output would serve the previous version's code beside a manifest
 * that says otherwise. When the store has no `dist`, nothing is removed and the
 * rebuild regenerates it from the new sources.
 */
async function replaceFromStore(
  source: string,
  destination: string,
  knownInstallFiles?: TrackedFileHashes,
): Promise<void> {
  const storeFiles = await hashTrackedFiles(source);
  const installFiles = knownInstallFiles ?? (await hashTrackedFiles(destination));
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
 * Write the store's copy over an install and rebuild it.
 *
 * Shared by the boot pass and the override, because everything after the gate is
 * identical and the parts that matter are the ones a second copy gets wrong: the
 * replacement is a MIRROR, the manifest is re-read from what landed, and the
 * baseline is re-taken AFTER the build so the next pass compares against the
 * tree this one produced.
 */
async function applyStoreCopy(
  pluginId: string,
  storeDir: string,
  destination: string,
  from: string,
  to: string,
  installFiles: TrackedFileHashes,
): Promise<{ outcome: BundledSyncOutcome } | { error: string }> {
  await replaceFromStore(storeDir, destination, installFiles);

  const read = await readPluginManifest(destination);
  const manifest = read.kind === 'manifest' ? toManifest(read.value, destination) : null;
  if (!manifest || 'error' in manifest) return { error: 'the store copy has no valid manifest' };

  const build = await buildPanelPlugin(destination, manifest);
  invalidatePanelScan();
  // The new files are the baseline now — taken AFTER the build so the tree the
  // next pass compares against is the one this pass produced.
  await writeBaseline(pluginId, await hashTrackedFiles(destination));
  await writeBlockedSync(pluginId, null);
  return {
    outcome: {
      pluginId,
      from,
      to,
      // The store changed but its manifest version did not. Naming it keeps a
      // `1.0.0 → 1.0.0` line from reading as a no-op when a real fix landed.
      ...(from === to ? { contentOnly: true } : {}),
      ...(build.status === 'failed' ? { warning: build.reason ?? 'the plugin did not build' } : {}),
    },
  };
}

/**
 * Bring every installed bundled plugin up to the store's copy.
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
      // A manifest that cannot be read on either side means there is no
      // comparison to make at all — the scan reports it, and the sync leaves the
      // directory alone rather than guessing which side is wrong.
      if (!storeVersion || !installedVersion) {
        await writeBlockedSync(pluginId, null);
        continue;
      }

      // The baseline is taken when the install was WRITTEN, so a file that
      // differs from it is the user's. A plugin with no baseline predates this
      // check (or was installed by an older build), and running is the only
      // useful answer: refusing would freeze it forever with no way to say why.
      //
      // PROVENANCE and EVIDENCE are separate answers. A recorded baseline is what
      // proves Kabmo wrote this directory, so the content gate below applies
      // either way; only a baseline that still DESCRIBES the install may say a
      // file is the user's — see `baselineDescribesInstall`. Obeying a stale one
      // is what made the update unrecoverable: the rename rewrote every bundled
      // file while an older baseline was recorded, so every path read as the
      // user's edit and the only way out was removing the plugin.
      const recorded = await readBaseline(pluginId);
      const installFiles = await hashTrackedFiles(destination);
      const storeFiles = await hashTrackedFiles(join(storeRoot, pluginId));
      const trusted = recorded !== null && baselineDescribesInstall(recorded, installFiles, storeFiles);

      // WHICH GATE APPLIES IS DECIDED BY PROVENANCE, and the two answer
      // different questions:
      //
      // - A directory Kabmo wrote is compared by CONTENT. The store's tree is
      //   the source of truth for it, so any difference is an update — including
      //   a fix shipped without a version bump, and including the case that made
      //   this a bug: the product rename rewrote every bundled file AND reset the
      //   versions to 0.0.1, so a version gate could never see the store as
      //   newer and the plugin was stuck until it was removed and reinstalled
      //   (measured on a real install).
      // - A directory with no recorded baseline is of unknown provenance, so the
      //   conservative version gate stays: a hand-copied directory that happens
      //   to share a store id must not be overwritten by a store entry that is
      //   merely newer than it.
      const contentDiffers = changedPaths(installFiles, storeFiles).length > 0;
      const versionIsNewer = isNewer(storeVersion, installedVersion);
      const shouldApply = recorded ? contentDiffers : versionIsNewer;
      if (!shouldApply) {
        // Nothing to apply, so any earlier refusal no longer describes anything
        // the user has to act on.
        await writeBlockedSync(pluginId, null);
        // A stale baseline is replaced by what is on disk, so the next release's
        // update compares against reality rather than against history.
        if (recorded && !trusted) await writeBaseline(pluginId, installFiles);
        continue;
      }

      if (trusted) {
        const changed = changedPaths(recorded, installFiles);
        if (changed.length > 0) {
          blocked.push({ pluginId, from: installedVersion, to: storeVersion, changed });
          await writeBlockedSync(pluginId, { at: Date.now(), changed });
          continue;
        }
      }

      const applied = await applyStoreCopy(
        pluginId,
        join(storeRoot, pluginId),
        destination,
        installedVersion,
        storeVersion,
        installFiles,
      );
      if ('error' in applied) {
        failed.push({ pluginId, error: applied.error });
        continue;
      }
      updated.push(applied.outcome);
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
 * for the store's copy anyway, which is the only way past a baseline Kabmo
 * cannot reconcile. It applies the copy DIRECTLY rather than clearing the
 * baseline and re-running the pass: a cleared baseline makes the plugin read as
 * "unknown provenance", which is exactly the state the conservative version gate
 * governs — so the override silently became a no-op whenever the store's version
 * was not newer, which is the case it most often exists for.
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

  const from = (await manifestVersion(destination)) ?? 'unknown';
  const to = (await manifestVersion(storeDir)) ?? 'unknown';
  try {
    const applied = await applyStoreCopy(
      pluginId,
      storeDir,
      destination,
      from,
      to,
      await hashTrackedFiles(destination),
    );
    if ('error' in applied) return { ok: false, error: applied.error };
    emitRealtimeSignal('panels-changed');
    return { ok: true, ...(applied.outcome.warning ? { warning: applied.outcome.warning } : {}) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
