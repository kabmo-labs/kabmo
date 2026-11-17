/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `GET /api/sessions/:id/export` — the Markdown download a native shell fetches.
 *
 * The route exists because a shell cannot download a `blob:` URL: Android's
 * download listener ignores it and the desktop shells never see a navigation.
 * The cases pin the two halves of that contract: a real transcript answers a
 * Markdown attachment named for the session, and an empty one answers a
 * sentence instead of an empty file.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { getDb } from '@/server/db.server';
import type { DbClient } from '@/server/lib/db/client';
import { exportSessionMarkdown } from '@/server/routes/sessions/export';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';

let db: DbClient;
let priorMock: string | undefined;

beforeAll(async () => {
  await isolateDb();
  priorMock = Bun.env.MOCK;
  Bun.env.MOCK = 'true';
  db = await getDb();
});

afterAll(async () => {
  if (priorMock === undefined) delete Bun.env.MOCK;
  else Bun.env.MOCK = priorMock;
  await releaseDb();
});

async function seed(sessionId: string, title: string, messages: unknown[]): Promise<void> {
  await db.run(
    'INSERT OR REPLACE INTO chat_sessions (session_id, title, messages, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
    [sessionId, title, JSON.stringify(messages)],
  );
}

function request(sessionId: string): Request {
  return new Request(`http://localhost/api/sessions/${sessionId}/export`);
}

describe('session markdown export', () => {
  test('serves the transcript as a named Markdown attachment', async () => {
    await seed('s1', 'Fix the parser', [
      { id: 'u1', role: 'user', content: 'Why does it fail?' },
      { id: 'a1', role: 'assistant', content: 'Because the token is empty.' },
    ]);

    const response = await exportSessionMarkdown({ params: { sessionId: 's1' }, request: request('s1') });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="Fix-the-parser.md"');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.text();
    expect(body).toContain('# Fix the parser');
    expect(body).toContain('## User\n\nWhy does it fail?');
    expect(body).toContain('## Assistant\n\nBecause the token is empty.');
  });

  test('an empty transcript is a refusal, never an empty file', async () => {
    await seed('s2', 'Empty', []);

    const response = await exportSessionMarkdown({ params: { sessionId: 's2' }, request: request('s2') });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'This session has no transcript to export.' });
  });

  test('a missing id is refused before reading anything', async () => {
    const response = await exportSessionMarkdown({ params: {}, request: request('') });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Missing session id' });
  });
});
