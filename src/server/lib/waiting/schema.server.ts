/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Waiting-prompt schema, kept out of `db.server.ts`'s bootstrap block for the
 * same reason `btw/schema.server.ts` and `schedule/schema.server.ts` are:
 * called once per database open, from `initSchema`.
 *
 * `status` is stored rather than derived. "waiting" is a clock state, and the
 * claim that releases a prompt is a WRITE — two Kabmo instances share this file,
 * so the row itself has to say whether the prompt was already sent.
 */

import type { DbClient } from '@/server/lib/db/client';

const WAITING_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS waiting_prompts (
    id TEXT PRIMARY KEY,
    pending_id TEXT,
    depends_on TEXT NOT NULL,
    depends_on_title TEXT,
    message TEXT NOT NULL DEFAULT '',
    attachments TEXT NOT NULL DEFAULT '[]',
    provider TEXT,
    model_id TEXT,
    thinking_level TEXT,
    access_mode TEXT,
    modes TEXT,
    cwd TEXT NOT NULL DEFAULT '',
    folder_id INTEGER,
    status TEXT NOT NULL,
    session_id TEXT,
    error TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_waiting_status ON waiting_prompts (status, depends_on);
`;

/** Idempotent: the waiting prompts' own table, created on every database open. */
export async function ensureWaitingSchema(db: DbClient): Promise<void> {
  await db.exec(WAITING_SCHEMA_SQL);
}
