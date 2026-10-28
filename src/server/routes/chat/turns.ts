/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Full-history user-turn index for the timeline jump rail.
 *
 * The timeline only mounts a window of a long session (the newest 120 messages
 * plus whatever "Load earlier messages" pulled in), so a rail built from the
 * mounted rows shows a fraction of the conversation and cannot reach a turn
 * that was never paged in. This endpoint answers the same id/position question
 * the timeline does — the JSONL messages with Kabmo DB overlay merged —
 * but for the WHOLE session, and strips each row down to what a tick needs.
 *
 * Positions are indices into that full merged list, which is exactly the list
 * `GET /api/chat/:sessionId` pages through with `?before=`: a rail click pages
 * windows from that index until the target row is mounted, so the cursor the
 * rail carries is the same coordinate space the loader uses.
 */

import { json } from '@/server/lib/remix-compat';
import type { LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { getDb } from '@/server/db.server';
import { getSessionData } from '@/client/data/mock/chat';
import { isMockMode } from '@/server/mock.server';
import { findSessionFileById } from '@/server/lib/omp/session/locator';
import { loadSessionMessages } from '@/server/lib/omp/session/messages';
import { mergeOmpAttachments } from '@/server/lib/omp/session/merge-stored';
import { TURN_PREVIEW_CHARS } from '@/shared/lib/chat/timeline/turns';
import type { UserTurnRef } from '@/shared/types/chat';

/** One rail entry per user row: its id (the DOM jump target), its position in
 *  the full list (the paging cursor), and enough text for the tooltip. */
function toUserTurns(messages: Array<{ id?: string; role?: string; content?: string; date?: string; timestamp?: string }>): UserTurnRef[] {
  const turns: UserTurnRef[] = [];
  messages.forEach((message, index) => {
    if (message?.role !== 'user') return;
    const content = typeof message.content === 'string' ? message.content : '';
    turns.push({
      id: typeof message.id === 'string' && message.id ? message.id : `turn-${index}`,
      index,
      preview: content.slice(0, TURN_PREVIEW_CHARS),
      date: message.date,
      timestamp: message.timestamp,
    });
  });
  return turns;
}

export async function loader({ params }: LoaderFunctionArgs) {
  const { sessionId } = params;
  if (!sessionId) return json({ error: 'Session ID is required' }, { status: 400 });

  const mock = isMockMode();
  try {
    if (!mock) {
      const filePath = await findSessionFileById(sessionId);
      if (filePath) {
        const messages = await loadSessionMessages(filePath);
        const db = await getDb();
        const overlay = await db.get('SELECT messages FROM chat_sessions WHERE session_id = ?', [sessionId]);
        const overlaid = mergeOmpAttachments(messages, overlay?.messages);
        return json({ turns: toUserTurns(overlaid), total: overlaid.length, source: 'omp-jsonl' });
      }
    }

    // Kabmo-created sessions (mock or synthetic ids) answer from the DB copy,
    // mirroring the timeline loader's fallback.
    const db = await getDb();
    const existing = await db.get('SELECT messages FROM chat_sessions WHERE session_id = ?', [sessionId]);
    let messages: unknown[] = [];
    if (existing?.messages) {
      try {
        const parsed: unknown = JSON.parse(existing.messages);
        if (Array.isArray(parsed)) messages = parsed;
      } catch {
        messages = [];
      }
    } else if (mock) {
      messages = getSessionData(sessionId)?.messages ?? [];
    }
    return json({ turns: toUserTurns(messages as Array<{ role?: string; content?: string }>), total: messages.length, source: mock ? 'mock' : 'db' });
  } catch (error: unknown) {
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
