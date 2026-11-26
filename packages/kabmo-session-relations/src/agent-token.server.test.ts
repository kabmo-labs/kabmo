/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { getDb } from '@kabmo-labs/kabmo-db/lifecycle';
import { ensureSessionRelationsSchema } from '@/server/lib/sessions/schema.server';
import {
  agentTokenScopeForPath,
  createAgentToken,
  hashAgentToken,
  initAgentTokens,
  lookupAgentToken,
  rememberAgentToken,
  revokeAgentToken,
  verifyAgentToken,
} from './agent-token.server';

beforeEach(async () => {
  await isolateDb();
  await ensureSessionRelationsSchema(await getDb());
  globalThis.__kabmoAgentTokens = undefined;
});

afterEach(async () => {
  globalThis.__kabmoAgentTokens = undefined;
  await releaseDb();
});

describe('agent tokens', () => {
  test('a remembered token verifies and can be revoked', async () => {
    const token = createAgentToken();
    await rememberAgentToken('s1', token);
    expect(verifyAgentToken(token)).toBe('s1');
    expect(verifyAgentToken('other')).toBeNull();

    await revokeAgentToken('s1');
    expect(verifyAgentToken(token)).toBeNull();
  });

  test('the cache is rebuilt from the table after a restart', async () => {
    const token = createAgentToken();
    await rememberAgentToken('s1', token);
    globalThis.__kabmoAgentTokens = undefined;
    await initAgentTokens();
    expect(verifyAgentToken(token)).toBe('s1');
    // Only the hash is stored.
    const rows = (await (await getDb()).all('SELECT token_hash FROM session_agent_tokens')) as {
      token_hash: string;
    }[];
    expect(rows[0]?.token_hash).toBe(hashAgentToken(token));
  });

  test('the path scope names the session it may touch', () => {
    expect(agentTokenScopeForPath('/api/sessions/spawn')).toEqual({ kind: 'any' });
    expect(agentTokenScopeForPath('/api/agent/s1')).toEqual({ kind: 'tree', target: 's1' });
    expect(agentTokenScopeForPath('/api/chat/s1')).toEqual({ kind: 'tree', target: 's1' });
    expect(agentTokenScopeForPath('/api/sessions/s1/fork')).toEqual({ kind: 'tree', target: 's1' });
    expect(agentTokenScopeForPath('/api/sessions/s1/relations')).toEqual({ kind: 'tree', target: 's1' });
    expect(agentTokenScopeForPath('/api/sessions/s1/archive')).toBeNull();
    expect(agentTokenScopeForPath('/api/settings')).toBeNull();
  });

  test('a token this process never minted is found in the table', async () => {
    // The peer-instance case: the owning process spawned the session, so this
    // process's cache is empty while the row exists.
    const token = createAgentToken();
    await rememberAgentToken('s1', token);
    globalThis.__kabmoAgentTokens = undefined;

    expect(verifyAgentToken(token)).toBeNull();
    expect(await lookupAgentToken(token)).toBe('s1');
    // The read warms the cache, so the next call costs nothing.
    expect(verifyAgentToken(token)).toBe('s1');
  });

  test('a revoked token is not resurrected by the table fallback', async () => {
    const token = createAgentToken();
    await rememberAgentToken('s1', token);
    await revokeAgentToken('s1');
    globalThis.__kabmoAgentTokens = undefined;

    expect(await lookupAgentToken(token)).toBeNull();
  });
});
