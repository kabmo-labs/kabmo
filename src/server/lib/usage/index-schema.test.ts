/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The usage index's schema evolution.
 *
 * `CREATE TABLE IF NOT EXISTS` cannot add a column: a database written by the
 * pre-harness build has a `usage_rollup` without `harness`, and inserting the
 * new row shape would fail on every request. A version bump therefore DROPS the
 * derived tables and rebuilds them, and clears the freshness metadata so the
 * first request after the upgrade scans instead of reporting an empty index as
 * current.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { getDb } from '@/server/db.server';
import { ensureUsageIndexSchema } from '@/server/lib/usage/index-schema.server';

beforeAll(async () => {
  await isolateDb();
});

afterAll(async () => {
  await releaseDb();
});

describe('ensureUsageIndexSchema', () => {
  test('drops the pre-harness tables instead of leaving the old columns', async () => {
    const db = await getDb();
    await db.exec(`
      DROP TABLE IF EXISTS usage_rollup;
      DROP TABLE IF EXISTS usage_index_file;
      CREATE TABLE usage_rollup (session_file TEXT, day TEXT, provider TEXT, model TEXT, project TEXT);
      CREATE TABLE usage_index_file (session_file TEXT PRIMARY KEY, offset INTEGER, size INTEGER, mtime_ms REAL, indexed_at INTEGER);
      INSERT OR REPLACE INTO usage_index_meta (key, value) VALUES ('version', '1');
      INSERT OR REPLACE INTO usage_index_meta (key, value) VALUES ('indexed_at', '123');
    `);

    await ensureUsageIndexSchema(db);

    const rollup = await db.all<{ name: string }>('PRAGMA table_info(usage_rollup)');
    expect(rollup.map((column) => column.name)).toContain('harness');
    const files = await db.all<{ name: string }>('PRAGMA table_info(usage_index_file)');
    expect(files.map((column) => column.name)).toEqual(expect.arrayContaining(['source', 'harness']));
    const version = await db.get<{ value: string }>("SELECT value FROM usage_index_meta WHERE key = 'version'");
    expect(version?.value).toBe('2');
    const freshness = await db.get("SELECT value FROM usage_index_meta WHERE key = 'indexed_at'");
    expect(freshness).toBeNull();
  });
});
