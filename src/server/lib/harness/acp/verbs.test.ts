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
import { forkSession, listAllSessions, loadSession, newSession, resumeSession } from '@/server/lib/harness/acp/verbs';

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

describe('MCP servers on the session verbs', () => {
  const servers = [{ name: 'notes', command: 'npx', args: ['-y', 'notes'], env: [] }];

  test('session/new carries the list', async () => {
    const { calls, invoke } = recorder();
    await newSession(invoke, '/tmp/project', 1000, 1, servers);
    expect(calls).toEqual([{ method: 'session/new', params: { cwd: '/tmp/project', mcpServers: servers } }]);
  });

  test('session/load carries the list', async () => {
    const { calls, invoke } = recorder();
    await loadSession(invoke, 'agent-1', '/tmp/project', 1000, servers);
    expect(calls).toEqual([
      { method: 'session/load', params: { sessionId: 'agent-1', cwd: '/tmp/project', mcpServers: servers } },
    ]);
  });

  test('session/resume carries the list', async () => {
    const { calls, invoke } = recorder();
    await resumeSession(invoke, 'agent-1', '/tmp/project', 1000, 1, servers);
    expect(calls).toEqual([
      { method: 'session/resume', params: { sessionId: 'agent-1', cwd: '/tmp/project', mcpServers: servers } },
    ]);
  });

  test('session/fork carries the list', async () => {
    const { calls, invoke } = recorder();
    await forkSession(invoke, 'src', '/tmp/project', 1000, undefined, undefined, servers);
    expect(calls).toEqual([
      { method: 'session/fork', params: { sessionId: 'src', cwd: '/tmp/project', mcpServers: servers } },
    ]);
  });
});

describe('listAllSessions', () => {
  test('the first page carries no cwd and each next page carries its cursor', async () => {
    const calls: unknown[] = [];
    const invoke = async <T>(_method: string, params: unknown): Promise<T> => {
      calls.push(params);
      const cursor = (params as { cursor?: string }).cursor;
      return (cursor
        ? { sessions: [{ sessionId: 'b', cwd: '/p/b' }], nextCursor: null }
        : { sessions: [{ sessionId: 'a', cwd: '/p/a' }], nextCursor: 'c1' }) as T;
    };
    const sessions = await listAllSessions(invoke);
    expect(sessions.map((s) => s.sessionId)).toEqual(['a', 'b']);
    expect(calls).toEqual([{}, { cursor: 'c1' }]);
  });

  test('a repeated cursor ends the walk instead of looping', async () => {
    let pages = 0;
    const invoke = async <T>(): Promise<T> => {
      pages += 1;
      return { sessions: [], nextCursor: 'same' } as T;
    };
    await listAllSessions(invoke);
    expect(pages).toBe(2);
  });

  test('maxPages bounds a peer that keeps minting fresh cursors', async () => {
    let pages = 0;
    const invoke = async <T>(): Promise<T> => {
      pages += 1;
      return { sessions: [], nextCursor: `c${pages}` } as T;
    };
    await listAllSessions(invoke, 1000, 3);
    expect(pages).toBe(3);
  });
});
