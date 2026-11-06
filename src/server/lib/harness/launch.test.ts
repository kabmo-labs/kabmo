/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Capability reading, from an `initialize` + `session/new` pair a real agent
 * produced.
 *
 * The fixtures below are the measured shapes, not invented ones: omp publishes
 * `mode`/`model`/`thinking`, claude adds `effort`/`fast`/`ultracode`, dsh has no
 * `loadSession`, gemini has no `sessionCapabilities`. The point is that every
 * PANEL gates on this record, so a wrong flag hides a real panel or shows a
 * fabricated one.
 */

import { describe, expect, test } from 'bun:test';
import { capabilitiesFrom, configByCategory, selectValues, sessionLaunchCommand } from '@/server/lib/harness/launch';
import type { AcpInitializeResult, AcpConfigOption } from '@/server/lib/harness/acp/protocol';

const ompInit: AcpInitializeResult = {
  protocolVersion: 1,
  agentInfo: { name: 'omp', version: '18.16.0' },
  agentCapabilities: {
    loadSession: true,
    sessionCapabilities: { list: {}, fork: {}, resume: {}, close: {} },
    _meta: { steering: { supported: true } },
  },
  authMethods: [],
};

const ompConfig: AcpConfigOption[] = [
  { id: 'mode', category: 'mode', currentValue: 'default', options: [{ value: 'default' }, { value: 'plan' }] },
  { id: 'model', category: 'model', currentValue: 'a/b', options: [{ value: 'a/b' }, { value: 'a/c' }] },
  { id: 'thinking', category: 'thought_level', currentValue: 'high', options: [{ value: 'off' }, { value: 'high' }] },
];

const dshInit: AcpInitializeResult = {
  protocolVersion: 1,
  agentCapabilities: { sessionCapabilities: { close: {}, list: {}, resume: {} } },
};

describe('capabilitiesFrom', () => {
  test('reads omp: every selector, load, steering, and the mode ladder', () => {
    const caps = capabilitiesFrom(ompInit, ompConfig, { usage: true, plan: false });
    expect(caps).toMatchObject({
      configModel: 2,
      configThinking: 2,
      configMode: 2,
      modeValues: ['default', 'plan'],
      loadSession: true,
      listSessions: true,
      forkSession: true,
      closeSession: true,
      steerMode: 'steer',
      hasUsage: true,
      agentName: 'omp',
    });
  });

  test('dsh: no loadSession, no fork, no delete — the panels that need them go dark', () => {
    const caps = capabilitiesFrom(dshInit, [], { usage: false, plan: false });
    expect(caps.loadSession).toBe(false);
    expect(caps.forkSession).toBe(false);
    expect(caps.deleteSession).toBe(false);
    expect(caps.listSessions).toBe(true);
    expect(caps.resumeSession).toBe(true);
    expect(caps.steerMode).toBeNull();
  });

  test('an agent that reports nothing claims nothing', () => {
    const caps = capabilitiesFrom({ protocolVersion: 1 }, undefined, { usage: false, plan: false });
    expect(caps).toMatchObject({
      configModel: 0,
      hasUsage: false,
      hasPlan: false,
      loadSession: false,
      steerMode: null,
    });
  });

  test('usage and plan are OBSERVED, never assumed', () => {
    const caps = capabilitiesFrom(ompInit, ompConfig, { usage: false, plan: true });
    expect(caps.hasUsage).toBe(false);
    expect(caps.hasPlan).toBe(true);
  });
});

describe('selectValues', () => {
  test('flattens grouped options', () => {
    const option: AcpConfigOption = {
      id: 'model',
      category: 'model',
      options: [
        { group: 'recommended', options: [{ value: 'x', name: 'X' }] },
        { value: 'y', name: 'Y' },
      ],
    };
    expect(selectValues(option)).toEqual([{ value: 'x', name: 'X' }, { value: 'y', name: 'Y' }]);
  });

  test('a missing category is undefined, not an empty selector', () => {
    expect(configByCategory([], 'model')).toBeUndefined();
    expect(selectValues(undefined)).toEqual([]);
  });
});

describe('steering is advertised at the RESULT root', () => {
  test('_meta.steering next to agentCapabilities enables steer', () => {
    // omp 18.16.0 sends `{... "agentCapabilities": {...}, "_meta": {"steering":
    // {"supported": true}}}` — reading it from inside agentCapabilities found
    // nothing and reported "no steering" for the one agent that has it.
    const caps = capabilitiesFrom(
      { protocolVersion: 1, agentCapabilities: { loadSession: true }, _meta: { steering: { supported: true } } },
      [],
      { usage: false, plan: false },
    );
    expect(caps.steerMode).toBe('steer');
  });
});

describe('sessionLaunchCommand', () => {
  test('omp-acp loads the mode extension the rpc child gets', () => {
    // omp's ACP path dispatches extension commands locally inside
    // `session.prompt()`. Without `-e`, the client's `/kabmo-mode plan
    // republish` (sent on every attach) is an ordinary prompt: measured, it
    // started a MODEL turn on an `omp (ACP)` chat instead of re-announcing the
    // parked plan review.
    const argv = sessionLaunchCommand('omp-acp', ['omp', 'acp']);
    expect(argv.slice(0, 2)).toEqual(['omp', 'acp']);
    expect(argv).toContain('-e');
    const entry = argv[argv.indexOf('-e') + 1] ?? '';
    expect(entry.endsWith('/extensions/kabmo-modes/index.ts')).toBe(true);
  });

  test('a user command override still gets the extension appended', () => {
    const argv = sessionLaunchCommand('omp-acp', ['/opt/omp/bin/omp', 'acp']);
    expect(argv[0]).toBe('/opt/omp/bin/omp');
    expect(argv).toContain('-e');
  });

  test('other ACP agents never see an -e flag they do not accept', () => {
    const argv = sessionLaunchCommand('claude', ['npx', '-y', 'claude-agent-acp']);
    expect(argv).toEqual(['npx', '-y', 'claude-agent-acp']);
  });

  test('the table vector is not mutated in place', () => {
    const base = ['omp', 'acp'];
    sessionLaunchCommand('omp-acp', base);
    expect(base).toEqual(['omp', 'acp']);
  });
});
