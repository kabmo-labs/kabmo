/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Panel-plugin state that must exist before the first request is served.
 *
 * The bundled marketplace used to be COPIED into the working directory on first
 * boot. It no longer is: the bundled plugins are a STORE the user installs
 * from (VS Code's model — an extension is not installed until you install it),
 * so copying them would install everything on day one, which is exactly the
 * behaviour this file exists to end.
 *
 * What remains is the one thing that genuinely has to happen before the
 * listener opens: the working marketplace directory and its catalog must exist,
 * because the scan reads them and a missing catalog is reported as a fault
 * rather than as an empty store.
 *
 * There is deliberately NO marker and no one-time migration. A previous install
 * left the bundled plugins copied into the working directory; those stay where
 * they are and keep working (they are ordinary installed plugins now), and the
 * user removes them from the pane if they do not want them. Deleting them on
 * upgrade would be Kabmo taking a destructive action on files the user
 * may be using.
 */

import { mkdir } from 'fs/promises';
import { join } from 'path';
import { pathExists } from '@/server/lib/omp/core/paths';
import { getBundledMarketplaceDir, getMarketplaceCatalogPath, getMarketplacePluginsDir } from '@/server/lib/panels/registry.server';

export interface SeedResult {
  /** True when the working marketplace had to be initialized (no catalog yet). */
  seeded: boolean;
  /** Why nothing was created, or what could not be. */
  reason?: string;
}

/** The minimal catalog an empty working marketplace starts with. */
const EMPTY_CATALOG = {
  name: 'Kabmo',
  description: 'Panels you installed from the bundled marketplace or a git URL.',
  owner: { name: 'Kabmo' },
  plugins: [],
};

/**
 * Create the working marketplace if it does not exist yet.
 *
 * The bundled marketplace is only checked, never copied: a package with no
 * `marketplace/` directory still starts (the pane simply offers nothing), and
 * that is a state worth reporting rather than failing over.
 */
export async function seedDefaultMarketplace(): Promise<SeedResult> {
  const catalogPath = getMarketplaceCatalogPath();
  const hadCatalog = await pathExists(catalogPath);
  try {
    await mkdir(getMarketplacePluginsDir(), { recursive: true });
    if (!hadCatalog) {
      await Bun.write(catalogPath, JSON.stringify(EMPTY_CATALOG, null, 2) + '\n');
    }
  } catch (error) {
    return { seeded: false, reason: error instanceof Error ? error.message : String(error) };
  }

  if (!(await pathExists(join(getBundledMarketplaceDir(), 'plugins')))) {
    return { seeded: !hadCatalog, reason: 'no bundled marketplace in this package' };
  }
  return { seeded: !hadCatalog };
}
