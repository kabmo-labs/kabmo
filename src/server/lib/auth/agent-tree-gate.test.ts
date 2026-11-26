/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The gate with a password armed and an agent token in hand.
 *
 * This is the case that could not pass before: the scope was the id in the path,
 * compared to the token's session, so a coordinator could not read its worker
 * and a worker could not tell its coordinator. The measured three-worker run
 * only worked because the gate returns before the token check when
 * authentication is off — which is exactly the configuration a real install
 * does not use.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { authGate, initAuth } from '@/server/lib/auth/guard';
import { createAgentToken, rememberAgentToken } from '@kabmo-labs/kabmo-session/relations/agent-token.server';
import { ensureSessionRelationsSchema } from '@/server/lib/sessions/schema.server';
import { getDb } from '@/server/db.server';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';

let dataDir: string | null = null;
let tokenC = '';
let tokenW1 = '';

async function relation(sessionId: string, parentSessionId: string | null): Promise<void> {
  const db = await getDb();
  await db.run(
    'INSERT INTO session_relations (session_id, parent_session_id, created_at) VALUES (?, ?, ?)',
    [sessionId, parentSessionId, Date.now()],
  );
}

function request(pathname: string, token?: string): Request {
  return new Request(`http://localhost${pathname}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

beforeEach(async () => {
  await isolateDb();
  await ensureSessionRelationsSchema(await getDb());
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-tree-gate-'));
  Bun.env.KABMO_DATA_DIR = dataDir;
  globalThis.__kabmoAgentTokens = undefined;

  await relation('C', null);
  await relation('W1', 'C');
  await relation('W2', 'C');

  tokenC = createAgentToken();
  tokenW1 = createAgentToken();
  await rememberAgentToken('C', tokenC);
  await rememberAgentToken('W1', tokenW1);

  await initAuth('correct-horse');
});

afterEach(async () => {
  await initAuth(null);
  globalThis.__kabmoAgentTokens = undefined;
  delete Bun.env.KABMO_DATA_DIR;
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  dataDir = null;
  await releaseDb();
});

describe('an agent token reaches its tree', () => {
  test('a coordinator may read its worker', async () => {
    expect(await authGate(request('/api/chat/W1', tokenC))).toBeUndefined();
    expect(await authGate(request('/api/agent/W1', tokenC))).toBeUndefined();
  });

  test('a worker may tell its coordinator', async () => {
    expect(await authGate(request('/api/agent/C', tokenW1))).toBeUndefined();
    expect(await authGate(request('/api/sessions/C/relations', tokenW1))).toBeUndefined();
  });

  test('any token may spawn under itself', async () => {
    expect(await authGate(request('/api/sessions/spawn', tokenW1))).toBeUndefined();
  });

  test('a token minted by another process is accepted from the table', async () => {
    // Simulates the peer instance: the cache is empty, the row is not.
    globalThis.__kabmoAgentTokens = undefined;
    expect(await authGate(request('/api/chat/W1', tokenC))).toBeUndefined();
  });
});

describe('an agent token reaches nothing else', () => {
  test('a sibling is refused with a typed code', async () => {
    const response = await authGate(request('/api/chat/W2', tokenW1));
    expect(response?.status).toBe(403);
    expect(await response?.json()).toEqual({
      error: 'That session is not in this session’s tree',
      code: 'session_not_in_tree',
    });
  });

  test('an unknown session answers the same refusal, not a 404', async () => {
    // Identical to the sibling case on purpose: the gate must not become an id
    // oracle for an agent process.
    const response = await authGate(request('/api/chat/does-not-exist', tokenW1));
    expect(response?.status).toBe(403);
    expect((await response?.json()) as { code?: string }).toEqual(expect.objectContaining({ code: 'session_not_in_tree' }));
  });

  test('a token is not a UI credential', async () => {
    expect((await authGate(request('/api/settings', tokenC)))?.status).toBe(401);
  });

  test('a request with no token is still a 401', async () => {
    expect((await authGate(request('/api/chat/W1')))?.status).toBe(401);
  });
});
