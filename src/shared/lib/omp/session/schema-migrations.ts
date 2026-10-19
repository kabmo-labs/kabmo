/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Additive migrations for `session_stream_state`. `CREATE TABLE IF NOT EXISTS`
 * leaves an existing table alone, so a database created before `owner_pid`
 * existed would miss the column and every status read would fail on it.
 *
 * Split out of `@/server/lib/db/schema` for the same reason
 * `@/shared/lib/workspace/schema-migrations` is: the DDL block there owns table
 * creation, and each later column arrives in the module that explains it.
 */

import type { DbClient } from '@/server/lib/db/client';

async function addColumn(db: DbClient, statement: string): Promise<void> {
  try {
    await db.exec(statement);
  } catch {
    // Already present — a fresh install gets the column from the DDL.
  }
}

export async function migrateSessionStreamStateColumns(db: DbClient): Promise<void> {
  // Which Kabmo process is running the session, so any instance reading this
  // table can judge a `stream` row it does not own (see stream-state.server.ts).
  await addColumn(db, 'ALTER TABLE session_stream_state ADD COLUMN owner_pid INTEGER;');
  // The model that serves the session's run, so the generating indicator names
  // the real provider/model from the SAME loader that already carries the
  // stream status — instead of re-deriving it from the session JSONL.
  await addColumn(db, 'ALTER TABLE session_stream_state ADD COLUMN model_provider TEXT;');
  await addColumn(db, 'ALTER TABLE session_stream_state ADD COLUMN model_id TEXT;');
}
