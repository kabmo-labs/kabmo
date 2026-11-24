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
import { isAbsolute } from 'node:path';
import {
  normalizeCommands,
  normalizeConfigOptions,
  normalizeInitializeResult,
  normalizePermissionParams,
  normalizeSessionResult,
  planEntries,
  toAcpV2McpServers,
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
      // `embeddedContext` is present only when the agent said something about
      // it: an absent v2 field is not a refusal, and the prompt builder
      // downgrades `resource_link` blocks only on an explicit `false`.
      promptCapabilities: { image: true, audio: false },
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

  test('a v2 prompt capability is a support marker, and absence is unknown', () => {
    const supported = normalizeInitializeResult({
      protocolVersion: 2,
      info: { name: 'x', version: '1' },
      capabilities: { session: { prompt: { embeddedContext: {} } } },
    });
    expect(supported.agentCapabilities?.promptCapabilities?.embeddedContext).toBe(true);
    const silent = normalizeInitializeResult({
      protocolVersion: 2,
      info: { name: 'x', version: '1' },
      capabilities: { session: { prompt: {} } },
    });
    // Not `false`: v2 has no way to say "refused", and reading absence as a
    // refusal would strip `resource_link` blocks from agents that accept them.
    expect(silent.agentCapabilities?.promptCapabilities?.embeddedContext).toBeUndefined();
  });

  test('an agent without capabilities.session claims no session methods', () => {
    const init = normalizeInitializeResult({ protocolVersion: 2, info: { name: 'x', version: '1' }, capabilities: {} });
    expect(init.agentCapabilities?.sessionCapabilities).toEqual({});
  });

  test('a v1 result is passed through untouched', () => {
    const v1 = { protocolVersion: 1, agentCapabilities: { loadSession: true } };
    expect(normalizeInitializeResult(v1)).toBe(v1 as never);
  });

  test('a peer that reports 2 but answers in v1 shape is spoken to as v1', () => {
    const init = normalizeInitializeResult({
      protocolVersion: 2,
      agentCapabilities: { loadSession: true, promptCapabilities: { image: true } },
    });
    expect(init.protocolVersion).toBe(1);
    expect(init.agentCapabilities?.loadSession).toBe(true);
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

describe('toAcpV2McpServers', () => {
  test('tags stdio, keeps an absolute command, and carries the env pairs', () => {
    const out = toAcpV2McpServers([
      { name: 'echo', command: '/bin/echo', args: ['hi'], env: [{ name: 'A', value: 'B' }] },
    ]);
    expect(out).toEqual([
      { type: 'stdio', name: 'echo', command: '/bin/echo', args: ['hi'], env: [{ name: 'A', value: 'B' }] },
    ]);
  });

  // On the Windows runner `Bun.which('cmd.exe', { PATH })` answers null even
  // though System32 is on PATH (measured on the 6075ae5 gate), and
  // `withToolchainPath` is a documented no-op there. The resolution branch is
  // platform-independent, so POSIX pins it and Windows is left to the paths
  // that do not need a lookup.
  test.skipIf(process.platform === 'win32')('resolves a bare binary name to an absolute path', () => {
    const out = toAcpV2McpServers([{ name: 'sh', command: 'sh', args: [], env: [] }]);
    expect(out).toHaveLength(1);
    const first = out[0] as { type: string; command: string };
    expect(first.type).toBe('stdio');
    expect(isAbsolute(first.command)).toBe(true);
  });

  test('keeps http and sse tagged as the peer expects', () => {
    const out = toAcpV2McpServers([
      { type: 'http', name: 'web', url: 'http://127.0.0.1/mcp', headers: [{ name: 'X', value: 'Y' }] },
      { type: 'sse', name: 'stream', url: 'http://127.0.0.1/sse', headers: [] },
    ]);
    expect(out).toEqual([
      { type: 'http', name: 'web', url: 'http://127.0.0.1/mcp', headers: [{ name: 'X', value: 'Y' }] },
      { type: 'sse', name: 'stream', url: 'http://127.0.0.1/sse', headers: [] },
    ]);
  });

  test('skips a command nothing can resolve instead of failing the session', () => {
    const out = toAcpV2McpServers([
      { name: 'missing', command: 'kabmo-definitely-missing-xyz', args: [], env: [] },
    ]);
    expect(out).toEqual([]);
  });
});
