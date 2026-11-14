/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The outbox the phone reads when the console is not open.
 *
 * Notification decisions used to live in the PAGE: it diffed consecutive
 * `sidebar:status` snapshots and posted a banner for each `stream → finish`
 * transition. A backgrounded Android WebView is frozen, so no frame arrives,
 * nothing is decided, and the whole backlog is announced at once when the app
 * is resumed. The server is the only place that sees the transition whether or
 * not a page is alive, so the events are recorded here and delivered to
 * whoever is listening.
 *
 * A table rather than an in-memory ring: a server restart must not swallow the
 * one banner the operator was waiting for, and the phone may reconnect minutes
 * later. Pruning is by count and age (see `store.server.ts`), so the table is
 * bounded.
 */

import type { DbClient } from '@/server/lib/db/client';

export async function ensureNotificationSchema(db: DbClient): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS notification_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      session_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      duration_ms INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notification_events_created
      ON notification_events (created_at);
  `);
  // `CREATE TABLE IF NOT EXISTS` leaves an existing table alone, so an install
  // that predates the duration would miss the column and every read would fail
  // on it. Additive, and a fresh install already has it from the DDL above.
  try {
    await db.exec('ALTER TABLE notification_events ADD COLUMN duration_ms INTEGER;');
  } catch {
    // Already present.
  }
}
