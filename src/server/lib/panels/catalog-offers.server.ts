/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The plugins a `marketplace.json` OFFERS without holding them.
 *
 * A catalog entry's `source` is normally a directory inside the marketplace, and
 * the scan reads that directory. It may also be a REMOTE git URL, and then there
 * is nothing to scan: the entry is an offer, and installing it is a clone
 * exactly like a URL typed into the install form. That is what lets one catalog
 * curate plugins that live in their own repositories — the case a marketplace
 * owner has no way to express otherwise, short of vendoring a copy.
 *
 * Read from BOTH catalogs, for two different reasons: the working marketplace's
 * own file (the user curated a list), and the bundled one (Kabmo ships a curated
 * list). They merge into the pane's single "Available" grid, so a reader does
 * not have to know which file an offer came from.
 *
 * A remote offer carries no icon and no README: both are files inside the
 * plugin's directory, and the directory does not exist until the clone. The card
 * falls back to the plugin's initials and offers no reader, which is the honest
 * answer rather than a broken image.
 */

import { dirname } from 'path';
import type { PanelCatalogEntry } from '@/shared/types';
import { readJsonBody } from '@/server/lib/panels/files.server';
import { toMarketplaceCatalog } from '@/server/lib/panels/manifest';

/**
 * Every remote offer in one catalog file.
 *
 * `installed` compares the catalog's own `name` against the installed ids: a
 * remote entry names no manifest id (the manifest lives in a repository nobody
 * has cloned), so the catalog name is the only key available — and it is the
 * name the pane shows. A mismatch after an install would show the offer again,
 * which is a duplicate row rather than a wrong action.
 */
export async function readRemoteOffers(
  catalogPath: string,
  installed: ReadonlySet<string>,
): Promise<PanelCatalogEntry[]> {
  const read = await readJsonBody(catalogPath);
  if (read.kind !== 'body') return [];
  const catalog = toMarketplaceCatalog(read.value, dirname(catalogPath));
  if ('error' in catalog) return [];
  const offers: PanelCatalogEntry[] = [];
  for (const entry of catalog.plugins ?? []) {
    if (!entry.remote) continue;
    offers.push({
      pluginId: entry.name,
      name: entry.name,
      // A catalog entry states the version it publishes, or states nothing. The
      // clone's own manifest is authoritative once installed, and the card says
      // "unversioned" rather than inventing one.
      version: entry.version ?? '',
      ...(entry.description ? { description: entry.description } : {}),
      ...(entry.author ? { author: entry.author } : {}),
      ...(entry.homepage ? { homepage: entry.homepage } : {}),
      origin: 'git',
      url: entry.source,
      installed: installed.has(entry.name),
    });
  }
  return offers;
}
