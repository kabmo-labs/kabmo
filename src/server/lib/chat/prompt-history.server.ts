/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The composer's prompt recall (ArrowUp / ArrowDown).
 *
 * Written at the HTTP boundary where a client's prompt enters (the agent
 * routes), not inside the RPC dispatch: the dispatch also carries Kabmo's own
 * control prompts (`/kabmo-mode …`, title requests, goal kickoffs), and those
 * are not something the operator typed.
 */

import { getDb } from '@/server/db.server';
import { PROMPT_HISTORY_LIMIT } from '@/server/lib/chat/schema.server';

/**
 * Record one prompt the operator sent.
 *
 * A repeat of the session's newest entry is dropped: a refused send is retried
 * (and a queued item is delivered later) through the same route, and the
 * operator typed the text once. A failed write is logged, never thrown — the
 * prompt itself must not fail because its recall row did.
 */
export async function recordPrompt(sessionId: string | null, text: string): Promise<void> {
  const trimmed = text.trim();
  if (!sessionId || !trimmed) return;
  try {
    const db = await getDb();
    const last = await db.get<{ text: string }>(
      'SELECT text FROM prompt_history WHERE session_id = ? ORDER BY id DESC LIMIT 1',
      [sessionId],
    );
    if (last?.text === trimmed) return;
    await db.run('INSERT INTO prompt_history (session_id, text, created_at) VALUES (?, ?, ?)', [
      sessionId,
      trimmed,
      Date.now(),
    ]);
  } catch (error) {
    console.error('[prompt-history] could not record a prompt:', error);
  }
}

/**
 * The recall list, newest first.
 *
 * `sessionId` scopes it to one chat; `null` merges every session, which is what
 * a pending `new-…` chat asks for. Duplicates collapse to their newest
 * occurrence — the same prompt sent in two chats is one thing to recall.
 */
export async function listPrompts(sessionId: string | null, limit = PROMPT_HISTORY_LIMIT): Promise<string[]> {
  const db = await getDb();
  const rows = sessionId
    ? await db.all<{ text: string }>(
        'SELECT text, MAX(id) AS last_id FROM prompt_history WHERE session_id = ? GROUP BY text ORDER BY last_id DESC LIMIT ?',
        [sessionId, limit],
      )
    : await db.all<{ text: string }>(
        'SELECT text, MAX(id) AS last_id FROM prompt_history GROUP BY text ORDER BY last_id DESC LIMIT ?',
        [limit],
      );
  return rows.map((row) => row.text);
}
