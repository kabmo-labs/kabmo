/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The batch archive route's contract.
 *
 * These are request-shape and verdict checks: a malformed body must be refused
 * before anything is written, a valid id must actually land in
 * `archived_sessions`, and the two "not a real session" cases (a pending
 * `new-…` chat and a traversal id) must be per-id refusals while the rest of
 * the batch still runs.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { batchArchiveSessions } from '@/server/routes/sessions/batch-archive';
import { getDb } from '@/server/db.server';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';

beforeAll(async () => {
  // This suite reaches the database: `batchArchiveSessions` resolves `getDb()`.
  await isolateDb();
});

afterAll(async () => {
  await releaseDb();
});

function post(body: unknown, url = 'http://localhost/api/sessions/batch-archive'): Promise<Response> {
  return batchArchiveSessions({
    request: new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    params: {},
  } as never) as Promise<Response>;
}

async function isArchived(id: string): Promise<boolean> {
  const db = await getDb();
  return Boolean(await db.get('SELECT session_id FROM archived_sessions WHERE session_id = ?', [id]));
}

describe('batchArchiveSessions request shape', () => {
  test('a wrong verb is a 405', async () => {
    const res = (await batchArchiveSessions({
      request: new Request('http://localhost/api/sessions/batch-archive', { method: 'DELETE' }),
      params: {},
    } as never)) as Response;
    expect(res.status).toBe(405);
  });

  test('a non-array ids field is a 400', async () => {
    const res = await post({ ids: 'a' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'ids must be an array of session ids' });
  });

  test('an empty selection is a 400 rather than a no-op success', async () => {
    const res = await post({ ids: [] });
    expect(res.status).toBe(400);
  });

  test('an over-long selection is refused', async () => {
    const ids = Array.from({ length: 501 }, (_, index) => `s-${index}`);
    const res = await post({ ids });
    expect(res.status).toBe(400);
  });
});

describe('batchArchiveSessions verdicts', () => {
  test('a valid id is archived and the row exists', async () => {
    const res = await post({ ids: ['session-a'] });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; archived: string[]; refused: unknown[] };
    expect(body.success).toBe(true);
    expect(body.archived).toEqual(['session-a']);
    expect(body.refused).toEqual([]);
    expect(await isArchived('session-a')).toBe(true);
  });

  test('archiving is idempotent — the same id twice is one row', async () => {
    await post({ ids: ['session-b', 'session-b'] });
    const db = await getDb();
    const rows = await db.all('SELECT session_id FROM archived_sessions WHERE session_id = ?', ['session-b']);
    expect(rows).toHaveLength(1);
  });

  test('a pending chat is refused per id while the rest still archives', async () => {
    const res = await post({ ids: ['new-1758800000000', 'session-c'] });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      success: boolean;
      archived: string[];
      refused: { id: string; code?: string }[];
    };
    expect(body.success).toBe(false);
    expect(body.archived).toEqual(['session-c']);
    expect(body.refused.map((entry) => entry.id)).toEqual(['new-1758800000000']);
    expect(body.refused[0].code).toBe('session_pending');
    expect(await isArchived('new-1758800000000')).toBe(false);
    expect(await isArchived('session-c')).toBe(true);
  });

  test('a traversal id is refused without touching the tree', async () => {
    const res = await post({ ids: ['..'] });
    const body = await res.json() as { archived: string[]; refused: { code?: string }[] };
    expect(body.archived).toEqual([]);
    expect(body.refused[0].code).toBe('invalid_id');
  });
});
