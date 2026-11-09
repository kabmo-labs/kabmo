/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { getDb } from '@/server/db.server';
import { ensureSessionRelationsSchema } from '@/server/lib/sessions/schema.server';
import {
  agentTokenScopeForPath,
  createAgentToken,
  hashAgentToken,
  initAgentTokens,
  rememberAgentToken,
  revokeAgentToken,
  verifyAgentToken,
} from '@/server/lib/sessions/agent-token.server';

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
    expect(agentTokenScopeForPath('/api/sessions/spawn')).toBe('any');
    expect(agentTokenScopeForPath('/api/agent/s1')).toBe('s1');
    expect(agentTokenScopeForPath('/api/chat/s1')).toBe('s1');
    expect(agentTokenScopeForPath('/api/sessions/s1/fork')).toBe('s1');
    expect(agentTokenScopeForPath('/api/sessions/s1/relations')).toBe('s1');
    expect(agentTokenScopeForPath('/api/sessions/s1/archive')).toBeNull();
    expect(agentTokenScopeForPath('/api/settings')).toBeNull();
  });
});
