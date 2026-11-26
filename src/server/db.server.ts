/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The app's database composition root.
 *
 * The handle itself — the `globalThis` slot, the path resolution, `getDb`,
 * `closeDb`, `getDbSync` — lives in `@kabmo-labs/kabmo-db/lifecycle` so server
 * packages can import it without importing this file. What stays here is the
 * part that needs the app: creating the client, initializing the schema,
 * seeding mock data, syncing discovered workspaces, and the one-time legacy
 * settings migration. They run once per handle, through the registered opener.
 */

import { createDb, type DbClient } from '@kabmo-labs/kabmo-db/client';
import {
  registerDbOpener,
  type DbOpener,
} from '@kabmo-labs/kabmo-db/lifecycle';
import { initSchema } from '@/server/lib/db/schema';
import { seedMockData } from '@/server/lib/db/seed';
import { syncWorkspaceFoldersFromDiscovery } from '@/server/lib/db/workspace-sync';
import { isMockMode } from '@kabmo-labs/kabmo-runtime-flags';
import { migrateLegacyProjectSettings } from '@/shared/lib/workspace/project-settings-migration';

export { closeDb, getDatabasePath, getDb, getDbSync } from '@kabmo-labs/kabmo-db/lifecycle';

const openDatabase: DbOpener = async (dbPath: string): Promise<DbClient> => {
  const db = createDb(dbPath);
  await initSchema(db);

  if (isMockMode()) {
    await seedMockData(db);
  } else {
    // Seed workspace folders from discovered omp projects only while the list
    // is still empty. User-made folders are never deleted and a curated list is
    // never appended to; the sync is a one-time bootstrap.
    const seeded = await syncWorkspaceFoldersFromDiscovery(db);
    if (seeded) console.log('[kabmo] workspaces:    seeded from omp discovery (list was empty)');
  }

  await migrateLegacyProjectSettings(db);
  return db;
};

registerDbOpener(openDatabase);
