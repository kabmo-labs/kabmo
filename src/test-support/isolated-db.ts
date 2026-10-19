/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
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

import { removeDir } from '@/test-support/remove-dir';

let dir: string | null = null;

/** Point the process at a fresh database. Call from `beforeEach`. */
export function isolateDb(): string {
  globalThis.__kabmoDb?.resolved?.raw.close();
  globalThis.__kabmoDb = undefined;

  dir = mkdtempSync(join(tmpdir(), 'omc-db-'));
  const path = join(dir, 'db.sqlite');
  Bun.env.KABMO_DB_PATH = path;
  return path;
}

/** Close the handle and drop the temp directory. Call from `afterEach`. */
export function releaseDb(): void {
  globalThis.__kabmoDb?.resolved?.raw.close();
  globalThis.__kabmoDb = undefined;
  delete Bun.env.KABMO_DB_PATH;
  // `removeDir`, not a bare `rmSync`: a closed SQLite handle is released by the
  // OS asynchronously on Windows, so the delete races it and fails with EBUSY —
  // which, thrown from an `afterEach`, reports the PREVIOUS test as failed.
  if (dir) removeDir(dir);
  dir = null;
}
