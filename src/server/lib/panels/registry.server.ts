/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Panel-plugin discovery.
 *
 * One bundled marketplace, read from disk: the store inside the package is what
 * the pane offers, and the working copy under the data directory is what is
 * installed. This module owns the ROOTS, the scan CACHE and the PAYLOAD SHAPE;
 * the per-directory reading lives in `scan.server.ts` and the catalog/offer
 * merge in `offers.server.ts`.
 *
 * What it deliberately does NOT do:
 *
 * - copy or build the bundled plugins (that is `install.server.ts`, which makes
 *   a bundled install and a git install the same thing afterwards),
 * - probe a remote for freshness (that is a network round trip and lives in
 *   `git-update.server.ts`, whose result rides on the status cache),
 * - validate a manifest (`manifest.ts` owns the rules, so the scan, the
 *   installer and the builder cannot disagree about what a plugin is).
 *
 * A plugin directory that is broken is REPORTED, never hidden: a plugin that
 * fails to load with no reason reads as a plugin that was never installed, which
 * is the single most confusing failure this surface can have.
 */

import { join, resolve } from 'path';
import type { PanelRegistryPayload } from '@/shared/types';
import { pathExists } from '@/server/lib/omp/core/paths';
import { packageDir } from '@/server/lib/fs/package-root';
import { getDataDir } from '@/server/lib/lifecycle/paths';
import { readDisabledPlugins, readPluginAutoUpdate } from '@/server/lib/panels/state.server';
import { readAllGitStatuses } from '@/server/lib/panels/git-status.server';
import { readBlockedSyncs } from '@/server/lib/panels/baseline.server';
import { readJsonBody, subdirectories } from '@/server/lib/panels/files.server';
import { toMarketplaceCatalog } from '@/server/lib/panels/manifest';
import { basenameOf } from '@/server/lib/panels/assets.server';
import { runningVersions } from '@/server/lib/panels/compat.server';
import { scanInstalledPlugins } from '@/server/lib/panels/scan.server';
import { applySources, assembleCatalog } from '@/server/lib/panels/offers.server';

/** The marketplace root: `<data>/marketplace`, overridable for tests. */
export function getMarketplaceDir(): string {
  const override = Bun.env.KABMO_MARKETPLACE_DIR ?? Bun.env.OMPCHAMBER_MARKETPLACE_DIR;
  if (override) return resolve(override);
  return join(getDataDir(), 'marketplace');
}

/** Where a plugin's files live inside the marketplace. */
export function getMarketplacePluginsDir(): string {
  return join(getMarketplaceDir(), 'plugins');
}

/** The catalog file, which an install appends its entry to. */
export function getMarketplaceCatalogPath(): string {
  return join(getMarketplaceDir(), 'marketplace.json');
}

/**
 * The STORE: the marketplace bundled with the package.
 *
 * Read-only and never copied. The bundled plugins are what the Panel Plugins
 * pane offers to install — an offer, not an install — so nothing here is
 * scanned as a contribution and nothing here is built. Installing one copies
 * its directory into the working marketplace and builds it there, exactly as a
 * git install does, which is what keeps the two install paths one code path.
 *
 * Overridable so the seed and install tests can point at a fixture tree.
 */
export function getBundledMarketplaceDir(): string {
  const override = Bun.env.KABMO_BUNDLED_MARKETPLACE_DIR ?? Bun.env.OMPCHAMBER_BUNDLED_MARKETPLACE_DIR;
  if (override) return resolve(override);
  return join(packageDir(), 'marketplace');
}

/** The marketplace's stable id, used to attribute panels and rejections. */
const MARKETPLACE_ID = 'kabmo';

const SCAN_CACHE_TTL_MS = 5_000;

/**
 * A scan result: the payload the client renders, plus the plugin → directory
 * map the bundle route needs.
 *
 * The two are deliberately separate. The directory is an absolute path on the
 * user's machine, and the payload is a browser response — publishing the install
 * layout to every plugin buys nothing, since the route resolves the root from
 * this map rather than from the request.
 */
interface PanelScan extends PanelRegistryPayload {
  dirs: Record<string, string>;
}

declare global {
  // eslint-disable-next-line no-var
  var __kabmoPanelScan: { at: number; dir: string; scan: PanelScan } | undefined;
}

/** Drop the scan cache — called after an install, a remove, or a Refresh. */
export function invalidatePanelScan(): void {
  globalThis.__kabmoPanelScan = undefined;
}

async function runPanelScan(): Promise<PanelScan> {
  const root = getMarketplaceDir();
  const scan: PanelScan = {
    panels: [],
    marketplaces: [],
    errors: [],
    plugins: [],
    catalog: [],
    disabledPanels: [],
    gitStatus: {},
    autoUpdate: false,
    syncBlocked: {},
    dirs: {},
  };

  // Rejections are tagged with the marketplace id so the pane groups by a value
  // rather than by matching on a path.
  const fail = (dir: string, reason: string, source?: string) =>
    scan.errors.push({ dir, reason, marketplace: MARKETPLACE_ID, ...(source ? { source } : {}) });

  let name = 'Kabmo';
  let description: string | undefined;

  const catalogRead = await readJsonBody(getMarketplaceCatalogPath());
  if (catalogRead.kind === 'unreadable') {
    fail(getMarketplaceCatalogPath(), 'marketplace.json is not valid JSON');
  } else if (catalogRead.kind === 'body') {
    const catalog = toMarketplaceCatalog(catalogRead.value, root);
    if ('error' in catalog) {
      fail(getMarketplaceCatalogPath(), catalog.error);
    } else {
      name = catalog.name ?? name;
      description = catalog.description;
      // A catalog entry naming a directory that holds no plugin is reported: it
      // is the file saying "this is installed" while the scan found nothing, and
      // silence would make a failed install look like a plugin that refused to
      // load. The entry's own `source` rides along so the pane can drop that one
      // entry — the row is otherwise a dead end the user cannot clear.
      for (const entry of catalog.plugins ?? []) {
        // A REMOTE source names no directory here — it is an offer the pane
        // lists and `install` clones, so checking for a folder would report
        // every curated git plugin as a dangling entry.
        if (entry.remote) continue;
        const source = resolve(root, entry.source);
        if (!(await pathExists(source))) {
          fail(source, `listed in marketplace.json but no plugin was found there (${entry.name})`, entry.source);
        }
      }
    }
  }

  // Read once, before the loop: whether a plugin is ON decides whether its
  // bundle is published, and the flag is stored rather than derived.
  const disabledList = await readDisabledPlugins();
  // The raw list travels with the payload: a BUILT-IN view is named by its bare
  // id and the server has no built-in list to resolve it against, so the client
  // is what filters its own views. The scan itself only ever asks about plugin
  // ids, which is why the membership test is a `Set`.
  scan.disabledPanels = disabledList;
  const scanned = await scanInstalledPlugins({
    pluginsRoot: getMarketplacePluginsDir(),
    disabled: new Set(disabledList),
    // Resolved ONCE per scan: a plugin's `engines` is compared against what is
    // running HERE, never a constant.
    running: await runningVersions(),
    marketplace: MARKETPLACE_ID,
  });
  scan.plugins = scanned.pluginStatus;
  scan.panels = scanned.panels;
  scan.dirs = scanned.dirs;
  scan.errors.push(...scanned.errors);

  // The status cache is read BEFORE the offers are folded in, because a git
  // clone's `latestVersion` comes from the freshness probe and the fold is what
  // copies it onto the row.
  scan.gitStatus = readAllGitStatuses();
  const installed = new Set(scanned.pluginStatus.map((plugin) => plugin.pluginId));
  scan.catalog = await assembleCatalog({
    workingCatalogPath: getMarketplaceCatalogPath(),
    bundledRoot: getBundledMarketplaceDir(),
    installed,
  });
  applySources(scan.plugins, scan.catalog, scan.gitStatus);

  scan.marketplaces.push({ id: MARKETPLACE_ID, name, description, panelCount: scan.panels.length, errors: [] });
  scan.autoUpdate = await readPluginAutoUpdate();
  scan.syncBlocked = await readBlockedSyncs();

  return scan;
}

async function cachedScan(): Promise<PanelScan> {
  const dir = getMarketplaceDir();
  const cached = globalThis.__kabmoPanelScan;
  if (cached && cached.dir === dir && Date.now() - cached.at < SCAN_CACHE_TTL_MS) return cached.scan;
  const scan = await runPanelScan();
  globalThis.__kabmoPanelScan = { at: Date.now(), dir, scan };
  return scan;
}

/** The client payload: the marketplace, its panels, and its rejections. */
export async function discoverPanelPlugins(): Promise<PanelRegistryPayload> {
  const { dirs: _dirs, ...payload } = await cachedScan();
  return payload;
}

/**
 * The absolute file one plugin's bundle or icon is served from, addressed by the
 * directory name the URL carries.
 *
 * The URL names a plugin DIRECTORY rather than an arbitrary path, so a caller
 * can only ever reach a file inside a plugin the registry knows: the route
 * resolves the root from this map and appends a relative path the manifest
 * already had validated.
 *
 * TWO roots are searched, in this order, and the order is the whole point:
 * the WORKING marketplace first, then the bundled STORE. A store card has to
 * draw an icon for a plugin that is not installed yet, so the bundled directory
 * must be reachable — while an installed plugin must win, or a card would keep
 * showing the shipped icon after the user replaced it. A directory that is
 * neither installed-and-enabled nor a bundled offer is not reachable at all,
 * which is what makes disabling a plugin stop its code from loading rather than
 * merely hiding its button.
 */
export async function findPluginDir(pluginName: string): Promise<string | undefined> {
  const scan = await cachedScan();
  for (const dir of Object.values(scan.dirs)) {
    if (basenameOf(dir) === pluginName) return dir;
  }
  const bundledRoot = join(getBundledMarketplaceDir(), 'plugins');
  for (const dir of await subdirectories(bundledRoot)) {
    if (dir === pluginName) return join(bundledRoot, dir);
  }
  return undefined;
}
