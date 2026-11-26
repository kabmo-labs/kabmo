/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Schema bootstrap for Kabmo database: the `CREATE TABLE IF NOT EXISTS`
 * block plus the in-place migrations that repair schemas written by older
 * installs. Split out of `@/server/db.server` so the connection lifecycle
 * there stays readable; the order below is load-bearing — the migrations run
 * between the two DDL blocks, after the tables they touch exist.
 */

import type { DbClient } from '@kabmo-labs/kabmo-db/client';
import { migrateQueueTableFk } from '@/server/lib/queue/schema-migration.server';
import { ensureBtwSchema } from '@/server/lib/btw/schema.server';
import { ensureScheduleSchema } from '@/server/lib/schedule/schema.server';
import { ensureWaitingSchema } from '@/server/lib/waiting/schema.server';
import { ensurePluginSchema } from '@/server/lib/plugins/schema.server';
import { ensureModelRolePresetSchema } from '@/server/lib/model-roles/schema.server';
import { ensureProviderIconSchema, repairProviderIconSvgs } from '@/server/lib/models/provider-icon-store.server';
import { ensureUsageIndexSchema } from '@/server/lib/usage/index-schema.server';
import { ensureWorktreeSchema } from '@kabmo-labs/kabmo-db/worktree-registry';
import { ensureReviewSchema } from '@/server/lib/review/schema.server';
import { ensureHarnessSchema } from '@kabmo-labs/kabmo-harness/schema/schema.server';
import { ensureSessionRelationsSchema } from '@/server/lib/sessions/schema.server';
import { ensurePromptHistorySchema } from '@/server/lib/chat/schema.server';
import { ensureSessionMcpSchema } from '@/server/lib/mcp/schema.server';
import { ensureNotificationSchema } from '@/server/lib/notifications/schema.server';
import { ensureConnectSchema } from '@/server/lib/connect/devices.server';
import { ensureAcpGrantSchema } from '@kabmo-labs/kabmo-acp/session-core/grants.server';
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

    -- A deleted session's tombstone. The agent's own store is the source an
    -- import copies from, and an agent that keeps the conversation (or a
    -- delete that only removed Kabmo's rows) would put the chat back on the
    -- next pass. The import and the sidebar skip every id here.
    CREATE TABLE IF NOT EXISTS deleted_sessions (
      session_id TEXT PRIMARY KEY,
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

    -- The sidebar's subagent badge, saved per file version so a restart does
    -- not re-derive it by streaming every transcript (see
    -- lib/omp/session/subagent-presence-store). Derived data: deleting the
    -- table only costs one cold pass.
    CREATE TABLE IF NOT EXISTS session_subagent_presence (
      session_path TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      has_subagents INTEGER NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0
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
      failure TEXT,
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
  // Prompts held until another session finishes, same reasoning.
  await ensureWaitingSchema(db);
  // The plugin platform's own tables (kv, records, settings).
  await ensurePluginSchema(db);
  // Named model-role presets (the role editor's preset picker).
  await ensureModelRolePresetSchema(db);
  await ensureProviderIconSchema(db);
  // Legacy rows may hold an SVG a browser rejects (`--` in a comment); repair
  // them before any surface reads the icon URL, and version the new bytes so an
  // immutable cached copy cannot keep painting nothing.
  await repairProviderIconSvgs(db);
  // Token-usage index: the rollup the telemetry panel reads instead of
  // re-scanning every transcript on each request.
  await ensureUsageIndexSchema(db);
  // Worktree registry: the ref each worktree branched from, and the identity
  // cache that keys its folder.
  await ensureWorktreeSchema(db);
  // Review annotations on a rendered markdown document (per block, per file).
  await ensureReviewSchema(db);

  // Harness ownership per session: the sidebar's mark needs it, and it has to
  // outlive the process that spawned the child (a restart, a second instance).
  await ensureHarnessSchema(db);
  // Session trees: parent, cleanup ownership and fork origin. Keyed by the id
  // the sidebar and the URL use, so it works for omp files and ACP sessions.
  await ensureSessionRelationsSchema(db);
  // The composer's ArrowUp recall: one row per prompt the operator sent.
  await ensurePromptHistorySchema(db);
  // Per-session MCP enablement: read by the spawn path, so it cannot live in
  // the client-owned `session_ui_state` blob.
  await ensureSessionMcpSchema(db);
  // The system-notification outbox: written by the run settles, read by a page
  // over the realtime socket and by the Android watcher over SSE.
  await ensureNotificationSchema(db);
  // Paired devices and their token hashes: the Connect page's list, and the
  // credential the auth gate verifies on every request from a phone.
  await ensureConnectSchema(db);
  // An ACP "always allow" decision survives the child it was made to.
  await ensureAcpGrantSchema(db);
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
