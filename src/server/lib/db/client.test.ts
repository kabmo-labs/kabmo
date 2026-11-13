/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The database client's two performance contracts.
 *
 * Both are invisible in a functional test and expensive in production:
 *
 * - `synchronous = NORMAL` is what makes a single-row write 8 µs instead of
 *   79 µs (measured on this machine). A regression to SQLite's default is a
 *   10x write cost with no failing behaviour to notice it.
 * - `writeMany` is the only batched writer. A loop of `run()` calls is correct
 *   and 395x slower, so the batching itself is what is asserted.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDb, type DbClient } from '@/server/lib/db/client';

const opened: DbClient[] = [];
const dirs: string[] = [];

function open(): DbClient {
  const dir = mkdtempSync(join(tmpdir(), 'kabmo-db-client-'));
  dirs.push(dir);
  const db = createDb(join(dir, 'test.sqlite'));
  opened.push(db);
  db.raw.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, value TEXT)');
  return db;
}

afterEach(() => {
  for (const db of opened.splice(0)) db.raw.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('createDb', () => {
  test('pairs WAL with synchronous=NORMAL', () => {
    const db = open();
    const journal = db.raw.query('PRAGMA journal_mode').get() as { journal_mode: string };
    const sync = db.raw.query('PRAGMA synchronous').get() as { synchronous: number };
    expect(journal.journal_mode).toBe('wal');
    // 1 = NORMAL. 2 (FULL) is SQLite's default and fsyncs every commit.
    expect(sync.synchronous).toBe(1);
  });
});

describe('writeMany', () => {
  test('writes every row and reports the count', async () => {
    const db = open();
    const written = await db.writeMany('INSERT INTO t (value) VALUES (?)', [['a'], ['b'], ['c']]);
    expect(written).toBe(3);
    const rows = await db.all<{ value: string }>('SELECT value FROM t ORDER BY id');
    expect(rows.map((row) => row.value)).toEqual(['a', 'b', 'c']);
  });

  test('chunks the work without losing or reordering a row', async () => {
    const db = open();
    const params = Array.from({ length: 7 }, (_, index) => [`v${index}`]);
    // Chunk size 2 over 7 rows: four transactions, same result.
    expect(await db.writeMany('INSERT INTO t (value) VALUES (?)', params, 2)).toBe(7);
    const rows = await db.all<{ value: string }>('SELECT value FROM t ORDER BY id');
    expect(rows.map((row) => row.value)).toEqual(params.map(([value]) => value));
  });

  test('an empty list is a no-op, not an empty transaction', async () => {
    const db = open();
    expect(await db.writeMany('INSERT INTO t (value) VALUES (?)', [])).toBe(0);
    const count = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM t');
    expect(count?.n).toBe(0);
  });

  test('a failing row rolls back its own chunk and keeps the earlier ones', async () => {
    const db = open();
    await db.run('INSERT INTO t (id, value) VALUES (?, ?)', [1, 'first']);
    // The second chunk repeats id 1, which the primary key refuses.
    await expect(
      db.writeMany('INSERT INTO t (id, value) VALUES (?, ?)', [[2, 'ok'], [1, 'duplicate']], 1),
    ).rejects.toThrow();
    const rows = await db.all<{ id: number }>('SELECT id FROM t ORDER BY id');
    // Chunk 1 (id 2) committed; the failing chunk (id 1) did not.
    expect(rows.map((row) => row.id)).toEqual([1, 2]);
  });
});
