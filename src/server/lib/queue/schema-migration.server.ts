/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Schema migration for `queued_messages`: installs older databases created the
 * table with an FK to `sessions`, but omp session ids have no row there —
 * every queue insert for a real session failed with FOREIGN KEY constraint
 * failed. Rebuilds the table without the FK, once, marker-keyed in
 * `app_settings` (same pattern as project-settings-migration).
 */

import type { DbClient } from '@/server/lib/db/client';

const QUEUE_FK_MARKER = 'queue_fk_removed';

const QUEUE_TABLE_SQL = `
  CREATE TABLE queued_messages_new (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    attachments TEXT NOT NULL DEFAULT '[]',
    provider TEXT,
    model_id TEXT,
    thinking_level TEXT,
    access_mode TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  INSERT INTO queued_messages_new
    (id, session_id, position, message, attachments, provider, model_id, thinking_level, access_mode, created_at)
  SELECT id, session_id, position, message, attachments, provider, model_id, thinking_level, access_mode, created_at
    FROM queued_messages;
  DROP TABLE queued_messages;
  ALTER TABLE queued_messages_new RENAME TO queued_messages;
`;

/** Drop the invalid queue FK on pre-migration databases (idempotent). */
export async function migrateQueueTableFk(db: DbClient): Promise<void> {
  const marker = await db.get('SELECT value FROM app_settings WHERE key = ?', [QUEUE_FK_MARKER]);
  if (marker?.value) return;

  const table = await db.get(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'queued_messages'",
  );
  const hasLegacyFk = Boolean(table?.sql) && String(table.sql).includes('FOREIGN KEY');
  if (hasLegacyFk) await db.exec(QUEUE_TABLE_SQL);
  await db.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [QUEUE_FK_MARKER, '1']);
}
