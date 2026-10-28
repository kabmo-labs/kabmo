/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Installing a panel plugin from a git URL.
 *
 * The install is a clone into the marketplace's own `plugins/` directory plus a
 * catalog entry, so an installed plugin and a bundled one are the same thing
 * afterwards — the scan does not distinguish them, and neither does the UI.
 *
 * Two properties are load-bearing:
 *
 * - **The clone lands in a temp directory first, and is moved into place only
 *   after its manifest validates.** A clone that fails halfway, or a repository
 *   that is not a plugin, must not leave a directory the scan then reports as
 *   broken; the marketplace either gains a working plugin or is untouched.
 * - **The destination name comes from the manifest id, not from the URL.** The
 *   repository's own name says nothing about the plugin's identity, and two
 *   clones of the same repo under different URLs must not produce two panels
 *   with one key.
 */

import { mkdir, rename, rm, cp } from 'fs/promises';
import { join } from 'path';
import { pathExists } from '@/server/lib/omp/core/paths';
import { gitRun, firstLine } from '@/server/lib/wiki/git';
import { isGitUrl, repoSlug } from '@/shared/lib/git/url';
import { toManifest } from '@/server/lib/panels/manifest';
import { buildPanelPlugin } from '@/server/lib/panels/build.server';
import { appendCatalogEntry, pruneCatalogEntry } from '@/server/lib/panels/catalog.server';
import {
  getBundledMarketplaceDir,
  getMarketplaceDir,
  getMarketplacePluginsDir,
  invalidatePanelScan,
} from '@/server/lib/panels/registry.server';
import { readPluginManifest } from '@/server/lib/panels/files.server';
import { hashTrackedFiles } from '@/server/lib/panels/local-edits.server';
import { clearBaseline, writeBaseline, writeBlockedSync } from '@/server/lib/panels/baseline.server';
import { emitRealtimeSignal } from '@/server/lib/realtime/signals.server';

const CLONE_TIMEOUT_MS = 120_000;

export interface InstallResult {
  ok: boolean;
  /** The plugin's manifest id, once its manifest has been read. */
  pluginId?: string;
  /** The directory the plugin was installed into. */
  dir?: string;
  error?: string;
}

/**
 * Move a staged plugin into the working marketplace and register it.
 *
 * Shared by the two install sources — a git clone and a bundled plugin copy —
 * because everything after staging is identical and the parts that matter are
 * the ones a second copy would get wrong: the manifest is read through the
 * scan's own reader, the destination name comes from the manifest's `id` rather
 * than from the source, the build runs BEFORE the catalog entry is written, and
 * a build failure leaves the directory in place so Rebuild can fix it.
 */
async function commitStagedInstall(stagingDir: string): Promise<InstallResult> {
  const pluginsDir = getMarketplacePluginsDir();
  const read = await readPluginManifest(stagingDir);
  if (read.kind === 'none') {
    await rm(stagingDir, { recursive: true, force: true });
    return { ok: false, error: 'That plugin has no kabmo.json, and no kabmo key in package.json.' };
  }
  if (read.kind === 'error') {
    await rm(stagingDir, { recursive: true, force: true });
    return { ok: false, error: read.reason };
  }

  const manifest = toManifest(read.value, stagingDir);
  if ('error' in manifest) {
    await rm(stagingDir, { recursive: true, force: true });
    return { ok: false, error: manifest.error };
  }

  await mkdir(pluginsDir, { recursive: true });
  const destination = join(pluginsDir, manifest.id);
  if (await pathExists(destination)) {
    await rm(stagingDir, { recursive: true, force: true });
    return { ok: false, error: `A plugin with id "${manifest.id}" is already installed.` };
  }

  await rename(stagingDir, destination);

  // Build BEFORE registering: a package whose build FAILS would otherwise be
  // listed as installed while its bundle 404s. A plugin that is
  // not a package is a different answer — its files are served as they are,
  // so it registers normally. The directory stays either way, so the pane can
  // offer a Rebuild.
  const build = await buildPanelPlugin(destination, manifest);
  if (build.status === 'failed') {
    invalidatePanelScan();
    // The baseline is recorded even here: the files WERE written, and the sync's
    // edit check is about the user's changes, not about whether the build
    // succeeded. The pane's own Rebuild is the repair for this state.
    await writeBaseline(manifest.id, await hashTrackedFiles(destination));
    return { ok: true, pluginId: manifest.id, dir: destination, error: build.reason ?? 'the plugin did not build' };
  }

  const catalog = await appendCatalogEntry({
    name: manifest.id,
    source: `plugins/${manifest.id}`,
    description: manifest.description,
    version: manifest.version,
  });

  invalidatePanelScan();
  // The reference the bundled sync compares against. Taken AFTER the build, so
  // the tree it describes is the one the install actually produced.
  await writeBaseline(manifest.id, await hashTrackedFiles(destination));
  if (!catalog.ok) {
    // The plugin IS installed — the directory is in place and the scan will
    // find it. Only the catalog entry failed, and the pane reports a missing
    // catalog entry as an error, so the outcome is honest rather than clean.
    emitRealtimeSignal('panels-changed');
    return { ok: true, pluginId: manifest.id, dir: destination, error: catalog.error };
  }
  emitRealtimeSignal('panels-changed');
  return { ok: true, pluginId: manifest.id, dir: destination };
}

/**
 * Clone `url` and install the plugin it contains.
 *
 * The order is: clone to a temp dir, then `commitStagedInstall` — read and
 * validate its manifest, move it to `plugins/<manifest.id>`, build it, and
 * append the catalog entry. Each step is a no-op for the next if it fails, so a
 * failure at any point leaves the marketplace in a state the scan still
 * describes correctly.
 */
export async function installPanelPluginFromGit(url: string): Promise<InstallResult> {
  if (!isGitUrl(url)) {
    return { ok: false, error: 'Expected an https, ssh or git@ URL.' };
  }

  const marketplaceDir = getMarketplaceDir();
  // The temp directory is a SIBLING of `plugins/`, not inside it: the scan
  // globs `plugins/*/`, so a half-cloned repository there would be reported as a
  // broken plugin for as long as the clone runs.
  const stagingDir = join(marketplaceDir, `.installing-${repoSlug(url)}-${Date.now()}`);

  try {
    await mkdir(marketplaceDir, { recursive: true });
    await rm(stagingDir, { recursive: true, force: true });

    const clone = await gitRun(['clone', '--depth', '1', '--quiet', url, stagingDir], {
      timeoutMs: CLONE_TIMEOUT_MS,
    });
    if (clone.failed || clone.exitCode !== 0) {
      await rm(stagingDir, { recursive: true, force: true });
      return { ok: false, error: firstLine(clone.stderr) || 'git clone failed' };
    }

    return await commitStagedInstall(stagingDir);
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Install one plugin the bundled marketplace offers.
 *
 * A COPY, not a symlink or a read-through: the bundled tree lives inside the
 * package, which is read-only in a global install and replaced outright by an
 * upgrade — a plugin served from there would vanish on the next update, and a
 * build would write into `node_modules`. Copying into the working marketplace
 * makes a bundled install and a git install the same thing afterwards, which is
 * the property the whole pane rests on.
 *
 * The staging directory is a sibling of `plugins/` for the same reason the git
 * clone stages there: the scan lists the subdirectories of `plugins`, so a
 * half-copied plugin would be reported as broken while the copy runs.
 */
export async function installPanelPluginFromBundled(pluginId: string): Promise<InstallResult> {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(pluginId)) return { ok: false, error: 'Invalid plugin id.' };

  const source = join(getBundledMarketplaceDir(), 'plugins', pluginId);
  if (!(await pathExists(source))) {
    return { ok: false, error: `No bundled plugin with id "${pluginId}".` };
  }

  const marketplaceDir = getMarketplaceDir();
  const stagingDir = join(marketplaceDir, `.installing-${pluginId}-${Date.now()}`);
  try {
    await mkdir(marketplaceDir, { recursive: true });
    await rm(stagingDir, { recursive: true, force: true });
    // A build output is never copied: `dist/` is gitignored, so the bundled
    // copy carries sources and the build here produces the served files —
    // identical to what the seed used to do, and to what a git install does.
    await cp(source, stagingDir, { recursive: true, force: true });
    return await commitStagedInstall(stagingDir);
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Remove a plugin: its directory AND its catalog entry.
 *
 * Both, because an install writes both. Dropping only the directory left the
 * catalog naming a path that no longer existed, so every removal produced a
 * permanent "Rejected — listed in marketplace.json but no plugin was found
 * there" row: the pane reporting the user's own successful action as a fault.
 *
 * The catalog is pruned by source path rather than by name, because the name an
 * install writes is the manifest id while a hand-written entry may use any
 * label — and it is the path that the scan resolves.
 */
export async function removePanelPlugin(pluginId: string): Promise<{ ok: boolean; error?: string }> {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(pluginId)) return { ok: false, error: 'Invalid plugin id.' };
  const dir = join(getMarketplacePluginsDir(), pluginId);
  if (!(await pathExists(dir))) return { ok: false, error: `No installed plugin with id "${pluginId}".` };
  try {
    await rm(dir, { recursive: true, force: true });
    // The baseline and any refusal describe files that no longer exist, and a
    // reinstall must start from a clean reference rather than inherit the
    // previous install's — or it would read as edited on its first pass.
    await clearBaseline(pluginId);
    await writeBlockedSync(pluginId, null);
    const pruned = await pruneCatalogEntry(`plugins/${pluginId}`);
    invalidatePanelScan();
    emitRealtimeSignal('panels-changed');
    // The directory is gone either way, so the removal succeeded; a catalog
    // that could not be pruned is reported rather than hidden, because the scan
    // will keep flagging the dangling entry.
    return pruned.ok ? { ok: true } : { ok: true, error: pruned.error };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

