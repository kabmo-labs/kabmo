/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The bundled marketplace's offers, as the pane's "Available" list.
 *
 * The store lives inside the package (`<package>/marketplace`), so this is a
 * plain directory read — no install, no build, nothing written. A store entry is
 * a plugin DIRECTORY with a valid manifest, the same rule the working scan
 * follows, so the two agree about what a plugin is; an entry whose manifest is
 * broken is skipped rather than reported, because the store is the app's own
 * shipping list and the pane has no action that could repair a packaging fault.
 *
 * Split out of the scan so the scan reads as what it is — one pass over the
 * working marketplace — and so this stays a pure read of a second directory.
 */

import { join } from 'path';
import type { PanelCatalogEntry } from '@/shared/types';
import { readPluginManifest, subdirectories } from '@/server/lib/panels/files.server';
import { toManifest } from '@/server/lib/panels/manifest';
import { iconUrl, readmeUrlFor } from '@/server/lib/panels/assets.server';

/**
 * The store root is a PARAMETER rather than a lookup, so this module does not
 * import the registry that calls it — the two would be a cycle, and the only
 * thing it needs is one path the caller already has.
 */
export async function readBundledCatalog(bundledRoot: string, installed: ReadonlySet<string>): Promise<PanelCatalogEntry[]> {
  const root = join(bundledRoot, 'plugins');
  const entries: PanelCatalogEntry[] = [];
  for (const pluginName of await subdirectories(root)) {
    const pluginDir = join(root, pluginName);
    const read = await readPluginManifest(pluginDir);
    if (read.kind !== 'manifest') continue;
    const manifest = toManifest(read.value, pluginDir);
    if ('error' in manifest) continue;
    entries.push({
      pluginId: manifest.id,
      name: manifest.name,
      version: manifest.version,
      ...(manifest.description ? { description: manifest.description } : {}),
      // The store's OWN icon and README, so a card can show the mark and the
      // details before the plugin is installed. Both come from the bundled
      // directory, which the routes resolve through the same registry.
      ...(manifest.icon ? { iconUrl: await iconUrl(pluginDir, manifest.icon) } : {}),
      ...(await readmeUrlFor(pluginDir, manifest)),
      ...(manifest.author ? { author: manifest.author } : {}),
      ...(manifest.homepage ? { homepage: manifest.homepage } : {}),
      ...(manifest.slots ? { slots: manifest.slots } : {}),
      // A store card names where the code will come from, because a bundled
      // install and a cloned one behave differently afterwards: one is kept
      // current by Kabmo's own sync, the other is the user's clone.
      origin: 'bundled',
      installed: installed.has(manifest.id),
    });
  }
  return entries;
}
