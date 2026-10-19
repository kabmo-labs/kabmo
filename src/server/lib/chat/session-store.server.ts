/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared session-message source resolution for the telemetry endpoints.
 * Source priority: omp session JSONL on disk, then Kabmo DB copy for
 * chat-created sessions, then mock data — so /api/telemetry/context and
 * /api/telemetry/raw-messages always agree on where a session's turns live.
 */

import { getDb } from '@/server/db.server';
import { isMockMode } from '@/server/mock.server';
import { getSessionData } from '@/client/data/mock/chat';
import { findSessionFileById } from '@/server/lib/omp/session/locator';

export interface JsonlSessionSource {
  kind: 'jsonl';
  filePath: string;
}

export interface MessageSessionSource {
  kind: 'messages';
  title: string;
  messages: unknown[];
}

export type SessionSource = JsonlSessionSource | MessageSessionSource;

export async function loadSessionSource(sessionId: string | null): Promise<SessionSource | null> {
  if (isMockMode()) {
    if (!sessionId) return null;
    const sessionMock = getSessionData(sessionId);
    if (sessionMock && sessionMock.messages && sessionMock.messages.length > 0) {
      return { kind: 'messages', title: sessionMock.title, messages: sessionMock.messages };
    }
    return null;
  }

  const db = await getDb();
  if (!sessionId) return null;

  // JSONL-first: omp sessions live on disk, so the raw panel shows full entries.
  const filePath = await findSessionFileById(sessionId);
  if (filePath) return { kind: 'jsonl', filePath };

  // Chat-created sessions have no JSONL on disk — fall back to the DB copy.
  const existing = await db.get('SELECT * FROM chat_sessions WHERE session_id = ?', [sessionId]);
  if (existing) {
    let parsedMessages: unknown[] = [];
    try {
      const parsed: unknown = JSON.parse(existing.messages);
      if (Array.isArray(parsed)) parsedMessages = parsed;
    } catch {
      parsedMessages = [];
    }
    return { kind: 'messages', title: existing.title || `Session ${sessionId}`, messages: parsedMessages };
  }
  return null;
}
