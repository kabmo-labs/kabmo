/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What the catalogs OFFER, and where each install came from.
 *
 * Two questions that must be answered together, which is why they live in one
 * module: the offer list says which plugin ids a store or a curated catalog
 * publishes, and the origin of an install is a property of THAT list — a
 * directory on disk cannot say whether it arrived from Kabmo's store, from a
 * clone, or from a folder someone dropped in.
 *
 * Three sources merge into one list, because to a reader they are one store:
 *
 * - the bundled marketplace (plugins shipped inside the package),
 * - the user's own `marketplace.json` (a curated list), and
 * - remote git offers from either catalog — entries whose `source` is a URL.
 *
 * A store offer wins over a remote one for the same id: its directory is on
 * disk, so it can draw an icon and a README, and both rows would install the
 * same id.
 */

import { join } from 'path';
import type {
  PanelCatalogEntry,
  PanelGitStatus,
  PanelPluginStatus,
} from '@/shared/types';
import { readBundledCatalog } from '@/server/lib/panels/bundled-catalog.server';
import { readRemoteOffers } from '@/server/lib/panels/catalog-offers.server';

/** The catalog payload: every offer, from every source, de-duplicated. */
export async function assembleCatalog(options: {
  /** The working marketplace's `marketplace.json`. */
  workingCatalogPath: string;
  /** The store shipped inside the package. */
  bundledRoot: string;
  /** Every plugin id already on disk, in any scope. */
  installed: ReadonlySet<string>;
}): Promise<PanelCatalogEntry[]> {
  const catalog = await readBundledCatalog(options.bundledRoot, options.installed);
  const remoteOffers = [
    ...(await readRemoteOffers(options.workingCatalogPath, options.installed)),
    ...(await readRemoteOffers(join(options.bundledRoot, 'marketplace.json'), options.installed)),
  ];
  const held = new Set(catalog.map((entry) => entry.pluginId));
  for (const offer of remoteOffers) {
    if (held.has(offer.pluginId)) continue;
    held.add(offer.pluginId);
    catalog.push(offer);
  }
  return catalog;
}

/**
 * Fill in what each install's SOURCE says about it: `bundled`, `origin`, and the
 * newer version when one is known.
 *
 * Mutates the rows rather than returning copies, because these are the payload's
 * own objects and a second list would be a second answer to the same question.
 *
 * The two version sources are different facts and both are read:
 *
 * - a BUNDLED install's source is the store, whose manifest is on disk — so its
 *   version is known without a network call;
 * - a GIT clone's source is its remote, which only a freshness probe can answer;
 *   `git-update.server.ts` writes that back onto the status cache, so it arrives
 *   here as `latestVersion` on the status row.
 *
 * A `latestVersion` is never invented: absent means "unknown", which the card
 * renders as the installed version alone.
 */
export function applySources(
  plugins: PanelPluginStatus[],
  catalog: readonly PanelCatalogEntry[],
  gitStatus: Readonly<Record<string, PanelGitStatus>>,
): void {
  const bundledIds = new Set(
    catalog.filter((entry) => entry.origin === 'bundled').map((entry) => entry.pluginId),
  );
  const storeVersions = new Map(
    catalog
      .filter((entry) => entry.origin === 'bundled' && entry.version)
      .map((entry) => [entry.pluginId, entry.version]),
  );

  for (const plugin of plugins) {
    // `bundled` is a property of the SOURCE, not of the install, and a git CLONE
    // is excluded however its id reads: the store offers a plugin under that id,
    // but the directory on disk is the user's own repository — and the sync that
    // keeps bundled installs current selects on this same flag, so attributing a
    // clone to the store would overwrite it on the next boot.
    plugin.bundled = bundledIds.has(plugin.pluginId) && plugin.gitOrigin === null;
    // The origin the card names is the same derivation, so a plugin cannot be
    // "bundled" on one line of its card and "git" on another.
    plugin.origin = plugin.gitOrigin ? 'git' : plugin.bundled ? 'bundled' : 'local';

    if (plugin.bundled) {
      const store = storeVersions.get(plugin.pluginId);
      if (store) plugin.latestVersion = store;
    }
    const probed = gitStatus[plugin.pluginId]?.latestVersion;
    if (probed && !plugin.latestVersion) plugin.latestVersion = probed;
  }
}
