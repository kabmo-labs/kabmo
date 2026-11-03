/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Token Usage index's own tables.
 *
 * The panel used to re-read the whole sessions tree (measured: 1 227 files /
 * 1 580 MB, 3.8–8.0 s) because its only cache was a 60-second in-memory scan.
 * Two tables replace that: `usage_rollup` holds counters per
 * (file, day, provider, model, project) — small enough to `GROUP BY` in
 * milliseconds — and `usage_index_file` holds how far each transcript has been
 * read, so the next pass reads only the bytes appended since.
 *
 * The unit of a rollup row is a FILE's contribution to one day, not one
 * message: a resumed session can add 40 000 entries for the same day, and one
 * row per message would make the index larger than the thing it indexes.
 * Re-indexing a file therefore REPLACES its rows (delete-then-insert), which
 * also makes a truncated or rewritten transcript correct rather than
 * double-counted.
 *
 * `day` is `''` (not NULL) for a record with no usable timestamp: SQLite
 * treats NULLs as distinct in a primary key, so two undated contributions
 * would both insert instead of accumulating, and every scan would grow the
 * table. An empty string sorts and groups as one bucket, which is also how the
 * window filters keep such records in EVERY period.
 */

import type { DbClient } from '@/server/lib/db/client';

/** Bumped when a rollup row's meaning changes; the index is dropped and rebuilt. */
export const USAGE_INDEX_VERSION = 1;

const USAGE_INDEX_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS usage_rollup (
    session_file TEXT NOT NULL,
    day TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    project TEXT NOT NULL,
    records INTEGER NOT NULL,
    unpriced INTEGER NOT NULL,
    input INTEGER NOT NULL,
    output INTEGER NOT NULL,
    cache_read INTEGER NOT NULL,
    cache_write INTEGER NOT NULL,
    reasoning INTEGER NOT NULL,
    total INTEGER NOT NULL,
    cost_total REAL NOT NULL,
    cost_input REAL NOT NULL,
    cost_output REAL NOT NULL,
    cost_cache_read REAL NOT NULL,
    cost_cache_write REAL NOT NULL,
    PRIMARY KEY (session_file, day, provider, model, project)
  );
  CREATE INDEX IF NOT EXISTS idx_usage_rollup_day ON usage_rollup (day);

  CREATE TABLE IF NOT EXISTS usage_index_file (
    session_file TEXT PRIMARY KEY,
    offset INTEGER NOT NULL,
    size INTEGER NOT NULL,
    mtime_ms REAL NOT NULL,
    indexed_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS usage_index_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

/** Idempotent: the usage index's tables, created on every database open. */
export async function ensureUsageIndexSchema(db: DbClient): Promise<void> {
  await db.exec(USAGE_INDEX_SCHEMA_SQL);
  const row = await db.get<{ value: string }>('SELECT value FROM usage_index_meta WHERE key = ?', ['version']);
  if (row?.value === String(USAGE_INDEX_VERSION)) return;
  // A different row meaning cannot be reinterpreted: drop the derived data and
  // let the next scan rebuild it. Never a silent misread.
  await db.exec('DELETE FROM usage_rollup; DELETE FROM usage_index_file;');
  await db.run('INSERT OR REPLACE INTO usage_index_meta (key, value) VALUES (?, ?)', ['version', String(USAGE_INDEX_VERSION)]);
}
