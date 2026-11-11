/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The wire shape of the ACP verbs Kabmo sends. `session/fork` is the one with
 * two optional payloads: zcode's checkpoint `target` and the AIR fork point in
 * `_meta` — an agent that does not read a key ignores it, so the shape is the
 * only thing that can be wrong here.
 */

import { describe, expect, test } from 'bun:test';
import { forkSession } from '@/server/lib/harness/acp/verbs';

function recorder() {
  const calls: Array<{ method: string; params: unknown }> = [];
  const invoke = async <T>(method: string, params: unknown): Promise<T> => {
    calls.push({ method, params });
    return { sessionId: 'forked' } as T;
  };
  return { calls, invoke };
}

describe('forkSession verb', () => {
  test('a plain fork sends only the session, cwd and servers', async () => {
    const { calls, invoke } = recorder();
    await forkSession(invoke, 'src', '/tmp/project', 1000);
    expect(calls).toEqual([
      { method: 'session/fork', params: { sessionId: 'src', cwd: '/tmp/project', mcpServers: [] } },
    ]);
  });

  test('a fork point rides as the request _meta', async () => {
    const { calls, invoke } = recorder();
    const meta = { jetbrains: { air: { fork: { version: 1, messageId: 'a2' } } } };
    await forkSession(invoke, 'src', '/tmp/project', 1000, undefined, meta);
    expect(calls).toEqual([
      {
        method: 'session/fork',
        params: { sessionId: 'src', cwd: '/tmp/project', mcpServers: [], _meta: meta },
      },
    ]);
  });

  test('a checkpoint target and a fork point travel together', async () => {
    const { calls, invoke } = recorder();
    const meta = { jetbrains: { air: { fork: { version: 1, messageId: 'a2' } } } };
    await forkSession(invoke, 'src', '/tmp/project', 1000, { kind: 'latestCheckpoint' }, meta);
    expect(calls).toEqual([
      {
        method: 'session/fork',
        params: {
          sessionId: 'src',
          cwd: '/tmp/project',
          mcpServers: [],
          target: { kind: 'latestCheckpoint' },
          _meta: meta,
        },
      },
    ]);
  });
});
