/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The BTW schema's migrations.
 *
 * `ensureBtwSchema` runs once per database open, so every branch has to be safe
 * on a database that already has the newest shape AND on one created before the
 * column or the status word existed. The status rename is the one that is easy
 * to get wrong: a stored `failed` is not a column, so it needs a data migration
 * rather than an `ALTER`, and a database written before the vocabulary changed
 * would otherwise render a turn that never completes.
 */

import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { createDb, type DbClient } from '@/server/lib/db/client';
import { ensureBtwSchema } from '@/server/lib/btw/schema.server';

const paths: string[] = [];

function tempDb(): DbClient {
  const path = join(tmpdir(), `btw-schema-${crypto.randomUUID()}.sqlite`);
  paths.push(path);
  return createDb(path);
}

describe('ensureBtwSchema', () => {
  test('creates the tables on a fresh database', async () => {
    const db = tempDb();
    await ensureBtwSchema(db);

    const columns = (await db.all('PRAGMA table_info(btw_topics)')) as { name: string }[];
    expect(columns.map((column) => column.name)).toContain('leaf_id');
    expect(columns.map((column) => column.name)).toContain('thinking_level');
  });

  test('is idempotent', async () => {
    const db = tempDb();
    await ensureBtwSchema(db);
    await ensureBtwSchema(db);

    const tables = (await db.all("SELECT name FROM sqlite_master WHERE type = 'table'")) as { name: string }[];
    expect(tables.filter((table) => table.name === 'btw_turns')).toHaveLength(1);
  });

  test('rewrites a legacy failed turn as error', async () => {
    const db = tempDb();
    // A database from before the vocabulary change: the column set is old and a
    // turn is recorded as `failed`.
    await db.exec(`
      CREATE TABLE btw_topics (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, title TEXT NOT NULL DEFAULT '',
        provider TEXT, model_id TEXT, model_name TEXT, leaf_id TEXT, promoted_session_id TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE btw_turns (
        topic_id TEXT NOT NULL, turn_index INTEGER NOT NULL, question TEXT NOT NULL DEFAULT '',
        answer TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        PRIMARY KEY (topic_id, turn_index)
      );
    `);
    await db.run(
      "INSERT INTO btw_turns (topic_id, turn_index, status, created_at, updated_at) VALUES ('t', 0, 'failed', 1, 1)",
    );

    await ensureBtwSchema(db);

    const turn = (await db.get("SELECT status FROM btw_turns WHERE topic_id = 't'")) as { status: string };
    expect(turn.status).toBe('error');
    // The additive columns arrive on the same pass.
    const columns = (await db.all('PRAGMA table_info(btw_topics)')) as { name: string }[];
    expect(columns.map((column) => column.name)).toContain('approval_mode');
  });
});

process.on('exit', () => {
  for (const path of paths) rmSync(path, { force: true });
});
