/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The v2 adapter.
 *
 * Every case pins a field the rest of Kabmo would otherwise read as v1:
 * role-agnostic `info`/`capabilities`, object support markers, `configId`,
 * permission `subject`, keyed plans, and the setup response's initial commands.
 */

import { describe, expect, test } from 'bun:test';
import {
  normalizeCommands,
  normalizeConfigOptions,
  normalizeInitializeResult,
  normalizePermissionParams,
  normalizeSessionResult,
  planEntries,
} from '@/server/lib/harness/acp/v2';

const v2Init = {
  protocolVersion: 2,
  info: { name: 'agent', title: 'Agent', version: '2.0.0' },
  capabilities: {
    session: {
      prompt: { image: {} },
      mcp: { http: {} },
      delete: {},
      additionalDirectories: {},
    },
    _meta: { steering: { supported: true } },
  },
  authMethods: [{ methodId: 'login', type: 'agent', name: 'Login' }],
};

describe('normalizeInitializeResult', () => {
  test('maps role-agnostic info and nested session capabilities to the v1 record', () => {
    const init = normalizeInitializeResult(v2Init);
    expect(init.protocolVersion).toBe(2);
    expect(init.agentInfo).toEqual({ name: 'agent', title: 'Agent', version: '2.0.0' });
    expect(init.agentCapabilities).toMatchObject({
      loadSession: false,
      promptCapabilities: { image: true, audio: false, embeddedContext: false },
      mcpCapabilities: { http: true, sse: false },
      sessionCapabilities: {
        list: {},
        resume: {},
        close: {},
        delete: {},
        additionalDirectories: {},
      },
    });
    expect(init.authMethods).toEqual([{ id: 'login', type: 'agent', name: 'Login' }]);
    expect(init._meta).toMatchObject({ steering: { supported: true } });
  });

  test('an agent without capabilities.session claims no session methods', () => {
    const init = normalizeInitializeResult({ protocolVersion: 2, info: { name: 'x', version: '1' }, capabilities: {} });
    expect(init.agentCapabilities?.sessionCapabilities).toEqual({});
  });

  test('a v1 result is passed through untouched', () => {
    const v1 = { protocolVersion: 1, agentCapabilities: { loadSession: true } };
    expect(normalizeInitializeResult(v1)).toBe(v1 as never);
  });
});

describe('normalizeConfigOptions', () => {
  test('renames configId and groupId and keeps nested selects', () => {
    const options = normalizeConfigOptions([
      {
        configId: 'model',
        name: 'Model',
        category: 'model',
        type: 'select',
        currentValue: 'a',
        options: [{ groupId: 'recommended', name: 'Recommended', options: [{ value: 'a', name: 'A' }] }],
      },
      { configId: 'brave', name: 'Brave', type: 'boolean', currentValue: false },
    ]);
    expect(options[0]).toMatchObject({ id: 'model', currentValue: 'a' });
    expect(options[0]?.options?.[0]).toMatchObject({ group: 'recommended' });
    expect(options[1]).toMatchObject({ id: 'brave', type: 'boolean', currentValue: false });
  });
});

describe('normalizeSessionResult', () => {
  test('adopts initial config options and slash commands', () => {
    const result = normalizeSessionResult({
      sessionId: 's1',
      configOptions: [{ configId: 'mode', category: 'mode', type: 'select', currentValue: 'ask' }],
      availableCommands: [{ type: 'command', name: 'test', description: 'Run tests', input: { type: 'text', hint: 'args' } }],
    });
    expect(result.sessionId).toBe('s1');
    expect(result.configOptions?.[0]).toMatchObject({ id: 'mode' });
    expect(result.availableCommands).toEqual([{ name: 'test', description: 'Run tests', inputHint: 'args' }]);
  });

  test('normalizeCommands drops entries without a name', () => {
    expect(normalizeCommands([{ name: 'x' }, { description: 'nameless' }, null])).toEqual([{ name: 'x' }]);
  });
});

describe('normalizePermissionParams', () => {
  test('a tool_call subject becomes the queue tool call, keeping the title', () => {
    const params = normalizePermissionParams({
      sessionId: 's1',
      title: 'Approve file edit?',
      subject: { type: 'tool_call', toolCall: { toolCallId: 'c1', kind: 'edit' } },
      options: [{ optionId: 'allow', kind: 'allow_once' }],
    });
    expect(params.toolCall).toMatchObject({ toolCallId: 'c1', kind: 'edit', title: 'Approve file edit?' });
  });

  test('a command subject becomes an exec tool call with the command as rawInput', () => {
    const params = normalizePermissionParams({
      sessionId: 's1',
      title: 'Run the tests?',
      subject: { type: 'command', command: 'cargo test', cwd: '/repo' },
      options: [],
    });
    expect(params.toolCall).toMatchObject({
      title: 'Run the tests?',
      kind: 'execute',
      rawInput: { command: 'cargo test', cwd: '/repo' },
    });
  });

  test('an absent subject still yields a titled prompt', () => {
    const params = normalizePermissionParams({ sessionId: 's1', title: 'Proceed?', options: [] });
    expect(params.toolCall).toMatchObject({ title: 'Proceed?' });
  });
});

describe('planEntries', () => {
  test('reads an items plan and replaces unknown types with an empty plan', () => {
    expect(planEntries({ plan: { type: 'items', planId: 'p1', entries: [{ content: 'a' }] } })).toEqual([{ content: 'a' }]);
    expect(planEntries({ plan: { type: '_future', planId: 'p2', entries: [{ content: 'a' }] } })).toEqual([]);
    expect(planEntries({})).toEqual([]);
  });
});
