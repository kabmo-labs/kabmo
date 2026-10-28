/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * SQLite-backed follow-up queue store (`queued_messages` table).
 *
 * The server is the single source of truth: the client panel is a view that
 * mutates through per-item operations, and every mutation returns the
 * canonical queue so callers reconcile from the response instead of merging
 * local state. Rows carry a model snapshot (provider, model_id,
 * thinking_level, access_mode) so auto-delivery replays the settings the item
 * was queued with.
 *
 * Delivery claims the head with a transactional DELETE (bun:sqlite is
 * synchronous, so BEGIN…COMMIT cannot interleave with another request), which
 * makes "exactly one consumer sends the head" hold across tabs, reloads and
 * concurrent nudges. A failed send re-inserts the claimed row at the head.
 */

import { getDb } from '@/server/db.server';
import { withTransaction } from '@/shared/lib/db/transaction.server';
import { isApprovalMode } from '@/shared/lib/omp/config/access-mode';
import { emitRealtimeSignal } from '@/server/lib/realtime/signals.server';
import type { QueuedMessage, QueuedMessageModel } from '@/shared/types/chat';

interface QueueRow {
  id: string;
  session_id: string;
  position: number;
  message: string;
  attachments: string;
  provider: string | null;
  model_id: string | null;
  thinking_level: string | null;
  access_mode: string | null;
}

export function rowToQueuedMessage(row: QueueRow): QueuedMessage {
  let attachments: unknown = [];
  try {
    attachments = JSON.parse(row.attachments);
  } catch {
    attachments = [];
  }
  const model: QueuedMessageModel | null =
    row.provider && row.model_id
      ? {
          provider: row.provider,
          modelId: row.model_id,
          thinkingLevel: row.thinking_level ?? 'auto',
          accessMode: isApprovalMode(row.access_mode) ? row.access_mode : 'always-ask',
        }
      : null;
  return {
    id: row.id,
    text: row.message,
    attachments: Array.isArray(attachments) ? (attachments as QueuedMessage['attachments']) : [],
    model,
  };
}

export function normalizeModel(raw: unknown): QueuedMessageModel | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.provider !== 'string' || typeof m.modelId !== 'string') return null;
  return {
    provider: m.provider,
    modelId: m.modelId,
    thinkingLevel: typeof m.thinkingLevel === 'string' ? m.thinkingLevel : 'auto',
    accessMode: isApprovalMode(m.accessMode) ? m.accessMode : 'always-ask',
  };
}

function serializeAttachments(attachments: unknown): string {
  return JSON.stringify(Array.isArray(attachments) ? attachments : []);
}

interface QueueItemInput {
  text: string;
  attachments?: unknown;
  model?: unknown;
}

/** The session's queued follow-ups in delivery order. */
export async function listQueue(sessionId: string): Promise<QueuedMessage[]> {
  const db = await getDb();
  const rows = (await db.all(
    'SELECT * FROM queued_messages WHERE session_id = ? ORDER BY position ASC',
    [sessionId],
  )) as QueueRow[];
  return rows.map(rowToQueuedMessage);
}

/** Append one item; returns the canonical queue. */
export async function appendQueueItem(sessionId: string, input: QueueItemInput): Promise<QueuedMessage[]> {
  const db = await getDb();
  const model = normalizeModel(input.model);
  const id = crypto.randomUUID();
  db.raw.run(
    `INSERT INTO queued_messages (id, session_id, position, message, attachments, provider, model_id, thinking_level, access_mode)
     VALUES (?, ?, COALESCE((SELECT MAX(position) FROM queued_messages WHERE session_id = ?), -1) + 1, ?, ?, ?, ?, ?, ?)`,
    [id, sessionId, sessionId, input.text, serializeAttachments(input.attachments),
      model?.provider ?? null, model?.modelId ?? null, model?.thinkingLevel ?? null, model?.accessMode ?? null],
  );
  emitRealtimeSignal('session-data-dirty', sessionId);
  return listQueue(sessionId);
}

/** Patch one item's text/model; null when the id is unknown. */
export async function patchQueueItem(
  sessionId: string,
  id: string,
  patch: { text?: unknown; model?: unknown },
): Promise<QueuedMessage[] | null> {
  const db = await getDb();
  const sets: string[] = [];
  const values: unknown[] = [];
  if (typeof patch.text === 'string') {
    sets.push('message = ?');
    values.push(patch.text);
  }
  if (patch.model !== undefined) {
    const model = normalizeModel(patch.model);
    sets.push('provider = ?', 'model_id = ?', 'thinking_level = ?', 'access_mode = ?');
    values.push(model?.provider ?? null, model?.modelId ?? null, model?.thinkingLevel ?? null, model?.accessMode ?? null);
  }
  if (sets.length === 0) return listQueue(sessionId);
  const result = await db.run(
    `UPDATE queued_messages SET ${sets.join(', ')} WHERE session_id = ? AND id = ?`,
    [...values, sessionId, id],
  );
  if (!result.changes) return null;
  emitRealtimeSignal('session-data-dirty', sessionId);
  return listQueue(sessionId);
}

/** Remove one item by id; false when it was already claimed or absent. */
export async function deleteQueueItem(sessionId: string, id: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.run('DELETE FROM queued_messages WHERE session_id = ? AND id = ?', [sessionId, id]);
  if (result.changes > 0) emitRealtimeSignal('session-data-dirty', sessionId);
  return result.changes > 0;
}

/** Reorder the queue to exactly `orderedIds` (unknown ids are ignored). */
export async function reorderQueue(sessionId: string, orderedIds: string[]): Promise<QueuedMessage[]> {
  const db = await getDb();
  withTransaction(db, () => {
    const update = db.raw.query('UPDATE queued_messages SET position = ? WHERE session_id = ? AND id = ?');
    orderedIds.forEach((id, index) => update.run(index, sessionId, id));
  });
  emitRealtimeSignal('session-data-dirty', sessionId);
  return listQueue(sessionId);
}

/**
 * Atomically claim the head for delivery: read + delete inside one
 * transaction, so a concurrent claimant (second tab, reload nudge racing a
 * run end) can never observe — and send — the same item twice. Null when the
 * queue is empty.
 *
 * Uses the ASYNC `getDb()` handle rather than `getDbSync()`, even though the
 * transaction block itself is synchronous (`bun:sqlite` is sync, so BEGIN…COMMIT
 * cannot interleave with another request and the atomicity above is unaffected
 * by the await before it). `getDbSync()` throws when its module-local resolved
 * handle is unset, which a `bun --hot` reload of `db.server.ts` does until some
 * other request calls `getDb()` — and the delivery path runs from a timer, so
 * nothing else necessarily would. That throw was swallowed by a fire-and-forget
 * call and stranded the queue silently, with nudges failing the same way.
 * `getDb()` re-initializes instead, so a delivery heals the state it needs.
 */
export async function claimHeadQueueItem(sessionId: string): Promise<QueuedMessage | null> {
  const db = await getDb();
  return withTransaction(db, () => {
    const row = db.raw
      .query('SELECT * FROM queued_messages WHERE session_id = ? ORDER BY position ASC LIMIT 1')
      .get(sessionId) as QueueRow | undefined;
    if (!row) return null;
    db.raw.run('DELETE FROM queued_messages WHERE id = ?', [row.id]);
    // The head left the queue: a panel showing it must be told, or it keeps
    // rendering an item that is already being sent.
    emitRealtimeSignal('session-data-dirty', sessionId);
    return rowToQueuedMessage(row);
  });
}

/**
 * Whether this session has anything queued, without claiming it.
 *
 * Used by the delivery retry to decide whether a retry is still worth arming:
 * a busy session whose queue emptied (delivered elsewhere, or deleted by the
 * user) must not leave a poll loop running. Async for the same reason the claim
 * is — `getDb()` heals a hot-reloaded module where `getDbSync()` would throw.
 */
export async function hasQueuedItem(sessionId: string): Promise<boolean> {
  const db = await getDb();
  const row = db.raw
    .query('SELECT 1 AS present FROM queued_messages WHERE session_id = ? LIMIT 1')
    .get(sessionId) as { present?: number } | undefined;
  return row?.present === 1;
}

/**
 * Put a failed delivery back at the head (position below the current minimum)
 * so it is retried before anything else. The next run end or mount nudge
 * picks it up again.
 */
export async function requeueHeadQueueItem(sessionId: string, item: QueuedMessage): Promise<void> {
  const db = await getDb();
  db.raw.run(
    `INSERT INTO queued_messages (id, session_id, position, message, attachments, provider, model_id, thinking_level, access_mode)
     VALUES (?, ?, COALESCE((SELECT MIN(position) FROM queued_messages WHERE session_id = ?), 0) - 1, ?, ?, ?, ?, ?, ?)`,
    [item.id, sessionId, sessionId, item.text, serializeAttachments(item.attachments),
      item.model?.provider ?? null, item.model?.modelId ?? null, item.model?.thinkingLevel ?? null, item.model?.accessMode ?? null],
  );
  emitRealtimeSignal('session-data-dirty', sessionId);
}
