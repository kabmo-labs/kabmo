/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The three handshake shapes: new, load, fork.
 *
 * The fork branch is the one that must never fall back: a harness that cannot
 * fork has to refuse, not open an empty session under the fork's name.
 */

import { describe, expect, test } from 'bun:test';
import { handshakeAcpSession, type AcpHandshakeTarget } from '@/server/lib/harness/acp/session-handshake';
import type { AcpConfigOption } from '@/server/lib/harness/acp/protocol';

function target(): AcpHandshakeTarget {
  return {
    cwd: '/tmp/project',
    harness: 'claude',
    sessionId: '',
    configOptions: [] as AcpConfigOption[],
    runModel: null,
    capabilities: {
      configModel: 0,
      configThinking: 0,
      configMode: 0,
      modeValues: [],
      loadSession: false,
      listSessions: false,
      forkSession: false,
      deleteSession: false,
      resumeSession: false,
      closeSession: false,
      hasUsage: false,
      hasPlan: false,
      steerMode: null,
    },
    async setConfig() {
      return {};
    },
  };
}

function processDouble(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  return {
    calls,
    async initialize() {
      return { protocolVersion: 1, agentCapabilities: {} };
    },
    async loadSession() {
      calls.push('load');
    },
    async newSession() {
      calls.push('new');
      return { sessionId: 'new-id' };
    },
    ...overrides,
  };
}

describe('handshakeAcpSession', () => {
  test('new starts a new agent session', async () => {
    const proc = processDouble();
    await handshakeAcpSession(target(), proc, { model: null, thinking: null, mode: null });
    expect(proc.calls).toEqual(['new']);
  });

  test('load restores and then starts the replacement session', async () => {
    const proc = processDouble();
    await handshakeAcpSession(target(), proc, { model: null, thinking: null, mode: null }, 'agent-1');
    expect(proc.calls).toEqual(['load', 'new']);
  });

  test('fork asks the agent for session/fork and uses the returned id', async () => {
    const proc = processDouble({
      async forkSession(sessionId: string) {
        proc.calls.push(`fork:${sessionId}`);
        return { sessionId: 'forked-id' };
      },
    });
    const session = target();
    await handshakeAcpSession(
      session,
      proc,
      { model: null, thinking: null, mode: null },
      undefined,
      'agent-1',
    );
    expect(proc.calls).toEqual(['fork:agent-1']);
    expect(session.sessionId).toBe('forked-id');
  });

  test('a process with no fork verb refuses instead of creating an empty session', async () => {
    const proc = processDouble();
    await expect(
      handshakeAcpSession(
        target(),
        proc,
        { model: null, thinking: null, mode: null },
        undefined,
        'agent-1',
      ),
    ).rejects.toThrow('cannot fork');
    expect(proc.calls).toEqual([]);
  });
});
