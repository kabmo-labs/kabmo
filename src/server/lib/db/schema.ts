/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Schema bootstrap for Kabmo database: the `CREATE TABLE IF NOT EXISTS`
 * block plus the in-place migrations that repair schemas written by older
 * installs. Split out of `@/server/db.server` so the connection lifecycle
 * there stays readable; the order below is load-bearing — the migrations run
 * between the two DDL blocks, after the tables they touch exist.
 */

import type { DbClient } from '@/server/lib/db/client';
import { migrateQueueTableFk } from '@/server/lib/queue/schema-migration.server';
import { ensureBtwSchema } from '@/server/lib/btw/schema.server';
import { ensureScheduleSchema } from '@/server/lib/schedule/schema.server';
import { ensurePluginSchema } from '@/server/lib/plugins/schema.server';
import { migrateWorkspaceFolderColumns } from '@/shared/lib/workspace/schema-migrations';
import { migrateSessionStreamStateColumns } from '@/shared/lib/omp/session/schema-migrations';

export async function initSchema(db: DbClient): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      is_expanded BOOLEAN DEFAULT 0,
      project_path TEXT,
      model TEXT DEFAULT 'Not selected',
      accent_color TEXT DEFAULT '',
      icon TEXT DEFAULT 'default',
      custom_icon_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      is_active BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (folder_id) REFERENCES workspace_folders (id)
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      session_id TEXT PRIMARY KEY,
      title TEXT,
      messages TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS deleted_workspaces (
      project_path TEXT PRIMARY KEY,
      deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS archived_sessions (
      session_id TEXT PRIMARY KEY,
      archived_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS session_ui_state (
      session_id TEXT PRIMARY KEY,
      state TEXT NOT NULL DEFAULT '{}',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS queued_messages (
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
    CREATE INDEX IF NOT EXISTS idx_queued_messages_session ON queued_messages (session_id, position);

    CREATE TABLE IF NOT EXISTS session_stream_state (
      session_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      owner_pid INTEGER,
      model_provider TEXT,
      model_id TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await migrateWorkspaceFolderColumns(db);
  // Installs older `queued_messages` schemas carry an invalid FK (see the
  // migration module); rebuild once so real-session queue inserts work.
  await migrateQueueTableFk(db);
  // `owner_pid` arrived after `session_stream_state` shipped; see the migration.
  await migrateSessionStreamStateColumns(db);
  // Side-question tables live in their own module (see schema.server.ts).
  await ensureBtwSchema(db);
  // Scheduled-task tables, same reasoning: their own module.
  await ensureScheduleSchema(db);
  // The plugin platform's own tables (kv, records, settings).
  await ensurePluginSchema(db);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      parent_id INTEGER,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      is_expanded BOOLEAN DEFAULT 0,
      FOREIGN KEY (session_id) REFERENCES sessions (id),
      FOREIGN KEY (parent_id) REFERENCES files (id)
    );
  `);
}
