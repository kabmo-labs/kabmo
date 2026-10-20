/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The batch routes' request contract.
 *
 * These are pure request-shape checks and they must not reach the filesystem or
 * spawn an omp child — which is half the point of asserting them: the batch
 * verbs are reachable from a click, so a malformed body has to be refused
 * before any id is resolved against the sessions root.
 *
 * The refusal half is the other point: a batch that names a pending `new-…`
 * chat must answer a per-id verdict and still delete the rest, because the
 * dialog reports counts rather than aborting.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { batchDeleteSessions } from '@/server/routes/sessions/batch-delete';
import { batchDeleteFolders } from '@/server/routes/folders/batch-delete';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { clearSessionFileCaches } from '@/server/lib/omp/session/files';

const AGENT_DIR = path.join(os.tmpdir(), `omc-batch-delete-${process.pid}`, 'agent');
let priorAgentDir: string | undefined;

beforeAll(() => {
  // This suite reaches the database: `removeSession` → `purgeSessionData`
  // resolves `getDb()`. Without isolating, it inherits whatever handle an
  // earlier file left on the process-wide slot — and when that handle points at
  // a temp directory its owner already deleted, SQLite answers `disk I/O error`
  // and the verdict loses its code (measured on CI: `not_found` came back
  // `undefined` while the same file passed alone).
  isolateDb();
  fs.rmSync(AGENT_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(AGENT_DIR, 'sessions'), { recursive: true });
  priorAgentDir = Bun.env.PI_CODING_AGENT_DIR;
  Bun.env.PI_CODING_AGENT_DIR = AGENT_DIR;
  clearSessionFileCaches();
});

afterAll(() => {
  clearSessionFileCaches();
  if (priorAgentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = priorAgentDir;
  fs.rmSync(path.dirname(AGENT_DIR), { recursive: true, force: true });
  releaseDb();
});

function post(body: unknown, url: string): Promise<Response> {
  return batchDeleteSessions({
    request: new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    params: {},
  } as never) as Promise<Response>;
}

function postFolder(body: unknown): Promise<Response> {
  return batchDeleteFolders({
    request: new Request('http://localhost/api/folders/batch-delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    params: {},
  } as never) as Promise<Response>;
}

describe('batchDeleteSessions request shape', () => {
  test('a wrong verb is a 405', async () => {
    const res = (await batchDeleteSessions({
      request: new Request('http://localhost/api/sessions/batch-delete', { method: 'DELETE' }),
      params: {},
    } as never)) as Response;
    expect(res.status).toBe(405);
  });

  test('a non-array ids field is a 400', async () => {
    const res = await post({ ids: 'a' }, 'http://localhost/api/sessions/batch-delete');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'ids must be an array of session ids' });
  });

  test('an empty selection is a 400 rather than a no-op success', async () => {
    const res = await post({ ids: [] }, 'http://localhost/api/sessions/batch-delete');
    expect(res.status).toBe(400);
  });

  test('an over-long selection is refused', async () => {
    const ids = Array.from({ length: 501 }, (_, index) => `s-${index}`);
    const res = await post({ ids }, 'http://localhost/api/sessions/batch-delete');
    expect(res.status).toBe(400);
  });

  test('a pending chat is refused per id while the rest still runs', async () => {
    // No files exist, so the real id answers not_found — the point is that the
    // pending one is refused by its OWN rule and the batch continues.
    const res = await post(
      { ids: ['new-1758800000000', '00000000-0000-0000-0000-000000000000'] },
      'http://localhost/api/sessions/batch-delete',
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; removed: string[]; refused: { id: string; code?: string }[] };
    expect(body.success).toBe(false);
    expect(body.removed).toEqual([]);
    expect(body.refused.map((entry) => entry.id)).toEqual([
      'new-1758800000000',
      '00000000-0000-0000-0000-000000000000',
    ]);
    expect(body.refused[0].code).toBe('session_pending');
    expect(body.refused[1].code).toBe('not_found');
  });

  test('a traversal id is refused without touching the tree', async () => {
    const res = await post({ ids: ['..'] }, 'http://localhost/api/sessions/batch-delete');
    const body = await res.json() as { refused: { code?: string }[] };
    expect(body.refused[0].code).toBe('invalid_id');
  });
});

describe('batchDeleteFolders request shape', () => {
  test('a non-array ids field is a 400', async () => {
    const res = await postFolder({ ids: 1 });
    expect(res.status).toBe(400);
  });

  test('an unknown workspace is refused per id', async () => {
    const res = await postFolder({ ids: ['424242'] });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; removed: string[]; refused: { code?: string }[] };
    expect(body.success).toBe(false);
    expect(body.removed).toEqual([]);
    expect(body.refused[0].code).toBe('not_found');
  });
});
