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
      // `session/load` is capability-gated on the AGENT's answer, so the double
      // advertises it unless a case replaces the whole method.
      return { protocolVersion: 1, agentCapabilities: { loadSession: true } };
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

  test('an agent with no loadSession but sessionCapabilities.resume resumes in place', async () => {
    const proc = processDouble({
      async initialize() {
        return {
          protocolVersion: 1,
          agentCapabilities: { loadSession: false, sessionCapabilities: { resume: {} } },
        };
      },
      async resumeSession(sessionId: string) {
        proc.calls.push(`resume:${sessionId}`);
        return { configOptions: [{ id: 'model', category: 'model', type: 'select', currentValue: 'a/b' }] };
      },
    });
    const session = target();
    await handshakeAcpSession(session, proc, { model: null, thinking: null, mode: null }, 'agent-1');
    // A resume replays nothing and creates nothing: no replacement session.
    expect(proc.calls).toEqual(['resume:agent-1']);
    expect(session.sessionId).toBe('agent-1');
    expect(session.runModel).toEqual({ provider: 'a', modelId: 'b' });
  });

  test('a legacy modes list applies the requested mode through session/set_mode', async () => {
    const proc = processDouble({
      async newSession() {
        proc.calls.push('new');
        return {
          sessionId: 'new-id',
          modes: {
            currentModeId: 'code',
            availableModes: [{ id: 'code', name: 'Code' }, { id: 'plan', name: 'Plan' }],
          },
        };
      },
    });
    const session = target();
    const applied: string[] = [];
    session.setMode = async (mode) => {
      applied.push(mode);
      return {};
    };
    await handshakeAcpSession(session, proc, { model: null, thinking: null, mode: 'plan' });
    expect(applied).toEqual(['plan']);
    expect(session.modes?.availableModes.map((entry) => entry.id)).toEqual(['code', 'plan']);
    expect(session.capabilities.configMode).toBe(2);
  });

  test('v2 resumes in place with resume, never session/load', async () => {
    const proc = processDouble({
      protocolVersion: 2,
      async initialize() {
        return {
          protocolVersion: 2,
          agentCapabilities: {
            loadSession: false,
            sessionCapabilities: { list: {}, resume: {}, close: {} },
          },
        };
      },
      async resumeSession(sessionId: string) {
        proc.calls.push(`resume:${sessionId}`);
        return {
          configOptions: [{ id: 'model', category: 'model', currentValue: 'a/b' }],
          availableCommands: [{ name: 'test', description: 'Run tests' }],
        };
      },
    });
    const session = target();
    await handshakeAcpSession(session, proc, { model: null, thinking: null, mode: null }, 'agent-1');
    expect(proc.calls).toEqual(['resume:agent-1']);
    expect(session.sessionId).toBe('agent-1');
    expect(session.runModel).toEqual({ provider: 'a', modelId: 'b' });
    expect(session.agentCommands).toEqual([{ name: 'test', description: 'Run tests' }]);
    expect(session.capabilities.resumeSession).toBe(true);
  });

  test('neither load nor resume is refused instead of calling an unadvertised method', async () => {
    const proc = processDouble({
      async initialize() {
        return { protocolVersion: 1, agentCapabilities: {} };
      },
    });
    await expect(
      handshakeAcpSession(target(), proc, { model: null, thinking: null, mode: null }, 'agent-1'),
    ).rejects.toThrow('neither session/load nor session/resume');
    expect(proc.calls).toEqual([]);
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

  test('a fork point travels to the agent as the request _meta', async () => {
    const seen: unknown[] = [];
    const proc = processDouble({
      async forkSession(
        sessionId: string,
        _cwd: string,
        _timeoutMs?: number,
        _target?: Record<string, unknown>,
        meta?: Record<string, unknown>,
      ) {
        seen.push({ sessionId, meta });
        return { sessionId: 'forked-id' };
      },
    });
    const meta = { jetbrains: { air: { fork: { version: 1, messageId: 'a2' } } } };
    await handshakeAcpSession(
      target(),
      proc,
      { model: null, thinking: null, mode: null },
      undefined,
      'agent-1',
      meta,
    );
    expect(seen).toEqual([{ sessionId: 'agent-1', meta }]);
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
