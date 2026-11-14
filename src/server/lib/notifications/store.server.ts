/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Read and write the notification outbox.
 *
 * Two consumers read the same rows: the realtime socket (a page that is open)
 * and `GET /api/notifications/stream` (the Android shell's watcher, which keeps
 * running when no page does). Both resume from an event id, so the id is the
 * cursor and the contract: an event older than the consumer's cursor is never
 * delivered twice.
 */

import { getDb } from '@/server/db.server';
import type { NotificationEvent } from '@/shared/lib/notifications/events';

/** How many rows the outbox keeps; older ones are pruned on every write. */
const KEEP_ROWS = 200;

/** How long a row survives, regardless of count. */
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

interface NotificationRow {
  id: number;
  kind: string;
  session_id: string;
  title: string;
  body: string;
  created_at: number;
}

function toEvent(row: NotificationRow): NotificationEvent {
  return {
    id: row.id,
    // An unknown kind is read as `finish`: the row is still a real event, and
    // dropping it would be the one outcome the outbox must not produce.
    kind: row.kind === 'error' || row.kind === 'ask' ? row.kind : 'finish',
    sessionId: row.session_id,
    title: row.title,
    body: row.body,
    at: row.created_at,
  };
}

/** Record one event and return the row, with the id the cursor advances to. */
export async function appendNotificationEvent(
  input: Omit<NotificationEvent, 'id' | 'at'>,
): Promise<NotificationEvent> {
  const db = await getDb();
  const at = Date.now();
  const result = await db.run(
    'INSERT INTO notification_events (kind, session_id, title, body, created_at) VALUES (?, ?, ?, ?, ?)',
    [input.kind, input.sessionId, input.title, input.body, at],
  );
  await pruneNotificationEvents();
  return { id: result.lastID, ...input, at };
}

/** Every event after `id`, oldest first. */
export async function listNotificationEventsAfter(id: number): Promise<NotificationEvent[]> {
  const db = await getDb();
  const rows = (await db.all(
    'SELECT id, kind, session_id, title, body, created_at FROM notification_events WHERE id > ? ORDER BY id ASC',
    [id],
  )) as NotificationRow[];
  return rows.map(toEvent);
}

/** The newest event id, or 0 when the outbox is empty — the prime cursor. */
export async function latestNotificationEventId(): Promise<number> {
  const db = await getDb();
  const row = (await db.get('SELECT MAX(id) AS id FROM notification_events')) as { id: number | null } | null;
  return row?.id ?? 0;
}

/**
 * Bound the outbox.
 *
 * Best-effort: a prune that fails must not turn a recorded event into a failed
 * one, and the next write tries again.
 */
export async function pruneNotificationEvents(): Promise<void> {
  try {
    const db = await getDb();
    await db.run('DELETE FROM notification_events WHERE created_at < ?', [Date.now() - KEEP_MS]);
    await db.run(
      `DELETE FROM notification_events
        WHERE id NOT IN (SELECT id FROM notification_events ORDER BY id DESC LIMIT ?)`,
      [KEEP_ROWS],
    );
  } catch {
    // The event is already recorded; retention is not the caller's concern.
  }
}
