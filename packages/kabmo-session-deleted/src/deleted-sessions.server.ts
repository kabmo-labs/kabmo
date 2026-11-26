/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The tombstone a deleted session leaves behind.
 *
 * Deleting a chat removes Kabmo's rows and asks the agent to drop its own copy.
 * That is not enough for an IMPORTED chat: the agent's store is the source the
 * import copies from, and an agent that keeps the conversation (or a delete
 * that only removed Kabmo's rows) puts the chat back on the next pass. The
 * reported defect is exactly that — delete an imported row, watch it return.
 *
 * `deleted_sessions` is the durable answer: the delete writes the id, and both
 * the import and the sidebar skip it. It is a TOMBSTONE, not a cache: it
 * outlives the process, a reload and a second instance, because the agent's
 * store does.
 *
 * The table is keyed by session id alone. A session id is unique across the
 * harnesses Kabmo records, and the id is what the import and the scan both
 * carry.
 */

import { getDb } from '@kabmo-labs/kabmo-db/lifecycle';

/** Tombstone one deleted session. Idempotent: a repeated delete is a no-op. */
export async function markSessionDeleted(sessionId: string): Promise<void> {
  if (!sessionId) return;
  const db = await getDb();
  await db.run('INSERT OR IGNORE INTO deleted_sessions (session_id) VALUES (?)', [sessionId]);
}

/**
 * Every tombstoned session id, for one import or sidebar pass.
 *
 * A Set rather than a per-row query: the import walks hundreds of rows and the
 * sidebar assembles every folder, so one read is the difference between one
 * query and one per session.
 */
export async function loadDeletedSessionIds(): Promise<Set<string>> {
  const db = await getDb();
  const rows = (await db.all('SELECT session_id FROM deleted_sessions')) as { session_id: string }[];
  return new Set(rows.map((row) => row.session_id));
}
