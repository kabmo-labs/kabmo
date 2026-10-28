/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * BTW schema, kept out of `db.server.ts`'s bootstrap block so that file's
 * growth stays attributable (it was already at the ceiling before this
 * feature). Called once per database open, like the other migrations there.
 *
 * `approval_mode` is retained for rows written while a side child ran WITH tools
 * and an approval dropdown governed it; nothing writes or reads it now that the
 * child runs `--no-tools`.
 */

import type { DbClient } from '@/server/lib/db/client';

const BTW_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS btw_topics (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    provider TEXT,
    model_id TEXT,
    model_name TEXT,
    thinking_level TEXT,
    approval_mode TEXT,
    leaf_id TEXT,
    promoted_session_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_btw_topics_session ON btw_topics (session_id, created_at ASC);

  CREATE TABLE IF NOT EXISTS btw_turns (
    topic_id TEXT NOT NULL,
    turn_index INTEGER NOT NULL,
    question TEXT NOT NULL DEFAULT '',
    answer TEXT NOT NULL DEFAULT '',
    messages TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (topic_id, turn_index)
  );
`;

/**
 * Columns added after the tables shipped. `CREATE TABLE IF NOT EXISTS` leaves an
 * existing table alone, so an install created before these existed would miss
 * them and every read would fail on the absent column. Additive only: a column
 * is added once, and a fresh database already has it from the DDL above.
 */
const BTW_ADDED_COLUMNS: { table: string; column: string; ddl: string }[] = [
  { table: 'btw_topics', column: 'thinking_level', ddl: 'ALTER TABLE btw_topics ADD COLUMN thinking_level TEXT' },
  { table: 'btw_topics', column: 'approval_mode', ddl: 'ALTER TABLE btw_topics ADD COLUMN approval_mode TEXT' },
  // A turn's conversation used to be the plain `answer` string alone; the panel
  // now renders the chat's own ChatMessageData, so the column arrives with the
  // default an empty conversation has.
  { table: 'btw_turns', column: 'messages', ddl: "ALTER TABLE btw_turns ADD COLUMN messages TEXT NOT NULL DEFAULT '[]'" },
];

async function hasColumn(db: DbClient, table: string, column: string): Promise<boolean> {
  const rows = (await db.all(`PRAGMA table_info(${table})`)) as { name?: string }[];
  return rows.some((row) => row.name === column);
}

/** Idempotent: side questions live beside the session they belong to. */
export async function ensureBtwSchema(db: DbClient): Promise<void> {
  await db.exec(BTW_SCHEMA_SQL);
  for (const added of BTW_ADDED_COLUMNS) {
    if (await hasColumn(db, added.table, added.column)) continue;
    await db.exec(added.ddl);
  }
  // A turn that ended in a provider error used to be recorded as `failed`; the
  // vocabulary now matches omp's own (`error`). Row data, not a column, so it is
  // an unconditional UPDATE — a second run matches nothing.
  await db.run("UPDATE btw_turns SET status = 'error' WHERE status = 'failed'");
}
