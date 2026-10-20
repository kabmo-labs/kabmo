/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Database lifecycle for Kabmo: resolve the SQLite path, open the
 * `bun:sqlite` client once, bootstrap the schema, and seed demo data in mock
 * mode. The DDL lives in `./db/schema`, the mock presets in `./db/seed` and
 * the workspace discovery sync in `./db/workspace-sync`. The one-time overlay
 * rewrite is NOT here: it is a server-lifecycle concern (`compact-chat-overlay`)
 * and runs from the server bootstrap, so opening a handle can never trigger it.
 */

import path from 'path';
import os from 'os';
import fs from 'fs';
import { createDb, type DbClient } from '@/server/lib/db/client';
import { initSchema } from '@/server/lib/db/schema';
import { seedMockData } from '@/server/lib/db/seed';
import { syncWorkspaceFoldersFromDiscovery } from '@/server/lib/db/workspace-sync';
import { isMockMode } from '@/server/mock.server';
import { pathExists } from '@/server/lib/omp/core/paths';
import { migrateLegacyProjectSettings } from '@/shared/lib/workspace/project-settings-migration';
import { getDataDir } from '@/server/lib/lifecycle/paths';

/**
 * The handle and its promise live on `globalThis`, not in module bindings.
 *
 * `bun run --hot` re-evaluates this module on every server-file edit while the
 * process lives on, so a module-level cache is reset each time and the previous
 * `Database` is dropped without ever being closed: measured on Bun 1.4.2 /
 * macOS, each reload of this file left two more descriptors behind (`db.sqlite`
 * and `db.sqlite-wal`), which is 2 per edit toward the 10,240-descriptor point
 * where every `Bun.spawn` in the process starts failing with `EBADF`. The slot
 * keeps ONE handle per process — the same reason the terminal registry, the
 * flock host and the provider cache are anchored here.
 */
interface DbSlot {
  /** In-flight open, so concurrent `getDb()` callers share one handle. */
  promise: Promise<DbClient> | null;
  /** Resolved handle for `getDbSync`; hot paths must not await. */
  resolved: DbClient | null;
}

declare global {
  // eslint-disable-next-line no-var
  var __kabmoDb: DbSlot | undefined;
}

function slot(): DbSlot {
  return (globalThis.__kabmoDb ??= { promise: null, resolved: null });
}

export async function getDatabasePath(): Promise<string> {
  // An explicit override wins over BOTH defaults, mock included. It has to come
  // first: the mock default is cwd-relative, so a `MOCK=true` server started
  // from a checkout wrote the repository's own `workspace.db` no matter what
  // the caller set — which is exactly what an isolated test or a second
  // instance needs the variable for. Verified before the fix: a mock boot with
  // `KABMO_DB_PATH` set to a temp file still answered the repo path on
  // this line.
  const customPath = Bun.env.KABMO_DB_PATH || Bun.env.OMPCHAMBER_DB_PATH || Bun.env.DB_PATH;
  if (customPath) {
    const resolvedPath = customPath.startsWith('~')
      ? path.join(os.homedir(), customPath.slice(1))
      : path.resolve(customPath);
    const dir = path.dirname(resolvedPath);
    if (!(await pathExists(dir))) {
      await fs.promises.mkdir(dir, { recursive: true });
    }
    return resolvedPath;
  }

  if (isMockMode()) {
    return path.join(process.cwd(), 'workspace.db');
  }

  const defaultDir = getDataDir();
  if (!(await pathExists(defaultDir))) {
    await fs.promises.mkdir(defaultDir, { recursive: true });
  }
  return path.join(defaultDir, 'db.sqlite');
}

export async function getDb(): Promise<DbClient> {
  const state = slot();
  if (state.promise) return state.promise;
  // A reload keeps the previous generation's handle: the schema was already
  // initialized in this process, and re-opening would leak the old one.
  if (state.resolved) return state.resolved;

  const opening = (async () => {
    const dbPath = await getDatabasePath();
    const db = createDb(dbPath);

    await initSchema(db);

    // Seed data based on MOCK mode
    if (isMockMode()) {
      // MOCK=true: demo workspace folders, sample chats, and session files
      await seedMockData(db);
    } else {
      // MOCK=false (Real Data Mode): when SYNC_WORKSPACE is enabled (default),
      // seed workspace folders from discovered omp projects — but only while
      // the list is still empty. User-made folders are never deleted and a
      // curated list is never appended to; the sync is a one-time bootstrap.
      const seeded = await syncWorkspaceFoldersFromDiscovery(db);
      if (seeded) console.log('[kabmo] workspaces:    seeded from omp discovery (list was empty)');
    }

    await migrateLegacyProjectSettings(db);

    state.resolved = db;
    return db;
  })();

  // A FAILED open must not be cached. `state.promise` is handed to every later
  // caller, so a rejection left in place makes one transient failure permanent
  // for the life of the process: measured on a Windows CI run, a single locked
  // temp database turned every subsequent `getDb()` into the same rejection,
  // and the suites that swallow it (`loadStreamStates`, the settings store)
  // answered empty for the rest of the run. Clearing the slot on failure means
  // the next caller retries against whatever path is configured by then — which
  // is also what a test that isolates itself between cases needs.
  state.promise = opening.catch((error: unknown) => {
    state.promise = null;
    throw error;
  });

  return state.promise;
}

/**
 * Synchronous handle for hot paths needing raw sync transactions
 * (`bun:sqlite` is sync, so BEGIN…COMMIT cannot interleave with another
 * request). The server initializes the db at startup; anything earlier must
 * use `getDb()`.
 */
export function getDbSync(): DbClient {
  const resolved = slot().resolved;
  if (!resolved) throw new Error('Database not initialized — call getDb() first');
  return resolved;
}
