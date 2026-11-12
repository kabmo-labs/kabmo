/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Prompt-recall schema, kept out of `db.server.ts`'s bootstrap block for the
 * same reason `btw/schema.server.ts` and `waiting/schema.server.ts` are: called
 * once per database open, from `initSchema`.
 *
 * A table of its own rather than a scan of the transcripts: a session's user
 * turns live in omp's JSONL (or the `chat_sessions` overlay), so the merged
 * list a NEW chat asks for would mean reading every session file on the
 * machine. One indexed row per dispatched prompt answers both scopes.
 */

import type { DbClient } from '@/server/lib/db/client';

const PROMPT_HISTORY_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS prompt_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_prompt_history_session ON prompt_history (session_id, id);
`;

/** How many entries one recall list may carry. */
export const PROMPT_HISTORY_LIMIT = 200;

/** Idempotent: the prompt-recall table, created on every database open. */
export async function ensurePromptHistorySchema(db: DbClient): Promise<void> {
  await db.exec(PROMPT_HISTORY_SCHEMA_SQL);
}
