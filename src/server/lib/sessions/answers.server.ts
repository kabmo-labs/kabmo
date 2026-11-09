/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The last assistant text a turn closed.
 *
 * ACP has no transcript Kabmo can read after the process dies, so the answer a
 * parent or a CLI asks for lived only in the closed message. Storing it is what
 * makes `kabmo session output` and the child-outcome notice agree after a
 * restart. omp rows are written too: the JSONL is authoritative, but one read
 * path is simpler than two.
 */

import { getDb } from '@/server/db.server';

export async function saveSessionAnswer(sessionId: string, answer: string): Promise<void> {
  const text = answer.trim();
  if (!text) return;
  const db = await getDb();
  await db.run(
    `INSERT INTO session_answers (session_id, answer, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET answer = excluded.answer, updated_at = excluded.updated_at`,
    [sessionId, text, Date.now()],
  );
}

export async function loadSessionAnswer(sessionId: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.get<{ answer: string }>(
    'SELECT answer FROM session_answers WHERE session_id = ?',
    [sessionId],
  );
  return row?.answer ?? null;
}
