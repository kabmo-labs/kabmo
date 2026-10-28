/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A database of one test file's own.
 *
 * The handle is a PROCESS-wide singleton (`globalThis.__kabmoDb`), and
 * `KABMO_DB_PATH` is read only while that handle is being opened. A suite
 * that sets the path inside a test therefore gets the handle an EARLIER file
 * already opened — which is the real `~/.kabmo/db.sqlite` whenever that
 * file did not isolate itself. The writes then land in the developer's own
 * database, which is how a panel-scan suite silently rewrote a live install's
 * `omp_panel_plugins` row.
 *
 * So the two steps are one call and their ORDER is the point: close and clear
 * the existing handle FIRST, then point the path at a temp file — a path set
 * while the old handle is still cached is never consulted.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { closeDb } from '@/server/db.server';
import { removeDir } from '@/test-support/remove-dir';

let dir: string | null = null;

/** Point the process at a fresh database. Call from `beforeEach`. */
export async function isolateDb(): Promise<string> {
  // Awaited: an open that was still in flight would otherwise reach `createDb`
  // AFTER the new path was set and open a file this call then loses track of.
  await closeDb();

  dir = mkdtempSync(join(tmpdir(), 'omc-db-'));
  const path = join(dir, 'db.sqlite');
  Bun.env.KABMO_DB_PATH = path;
  return path;
}

/**
 * Close the handle and drop the temp directory. Call from `afterEach`.
 *
 * **`await` it.** `closeDb` is only synchronous about retiring the SLOT; an
 * open already in flight still reaches `createDb` and opens a file. Deleting
 * the directory first raced that handle — and could not be won, because the
 * retry loop spins with `Bun.sleepSync` and blocks the very continuation that
 * would close it. Measured on the Release gate: `EBUSY … a handle outlived its
 * test` after the full 5s window, reported against the two PRECEDING cases,
 * plus "Unhandled error between tests" from the continuation's own rejection.
 */
export async function releaseDb(): Promise<void> {
  await closeDb();
  delete Bun.env.KABMO_DB_PATH;
  // `removeDir`, not a bare `rmSync`: a closed SQLite handle is released by the
  // OS asynchronously on Windows, so the delete races it and fails with EBUSY —
  // which, thrown from an `afterEach`, reports the PREVIOUS test as failed.
  if (dir) removeDir(dir);
  dir = null;
}
