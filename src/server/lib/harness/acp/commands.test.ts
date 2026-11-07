/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The ACP command vocabulary the routes send.
 *
 * `session/set_config_option` keys on the selector's own `id`; the CATEGORY is
 * only how the composer classifies it. Sending the category name worked only on
 * agents whose ids happened to match the words "model"/"thinking"/"mode".
 */

import { describe, expect, test } from 'bun:test';
import { dispatchCommand, type AcpCommandHost } from '@/server/lib/harness/acp/commands';
import type { AcpConfigOption } from '@/server/lib/harness/acp/protocol';

const option = (id: string, category: string, values: string[]): AcpConfigOption => ({
  id,
  category,
  type: 'select',
  currentValue: values[0],
  options: values.map((value) => ({ value })),
});

function host(): AcpCommandHost & { writes: [string, string | boolean][]; modes: string[] } {
  const writes: [string, string | boolean][] = [];
  const modes: string[] = [];
  return {
    writes,
    modes,
    harness: 'claude',
    sessionId: 's1',
    capabilities: {
      configModel: 1, configThinking: 1, configMode: 1, modeValues: ['default', 'plan'],
      loadSession: false, listSessions: false, forkSession: false, deleteSession: false,
      resumeSession: false, closeSession: false, hasUsage: false, hasPlan: false, steerMode: null,
    },
    configOptions: [
      option('sel-model', 'model', ['p/m', 'p/n']),
      option('sel-think', 'thought_level', ['low', 'high']),
      option('sel-mode', 'mode', ['default', 'plan']),
    ],
    agentCommands: [{ name: 'clear' }],
    startTurn: async () => ({ agentInvoked: true }),
    isAlive: () => true,
    destroyAndWait: async () => {},
    steer: async () => ({}),
    cancelTurn: () => {},
    setAccessMode: (mode) => {
      modes.push(mode);
    },
    setConfig: async (id, value) => {
      writes.push([id, value]);
      return { configOptions: [] };
    },
    resolvePermission: () => null,
    webState: () => ({}),
  };
}

describe('ACP dispatchCommand', () => {
  test('set_model / set_thinking_level / set_mode write the selector ids', async () => {
    const stub = host();
    await dispatchCommand(stub, { type: 'set_model', provider: 'p', modelId: 'n' });
    await dispatchCommand(stub, { type: 'set_thinking_level', level: 'high' });
    await dispatchCommand(stub, { type: 'set_mode', mode: 'plan' });
    expect(stub.writes).toEqual([
      ['sel-model', 'p/n'],
      ['sel-think', 'high'],
      ['sel-mode', 'plan'],
    ]);
  });

  test('a model the agent does not list is refused, not written', async () => {
    const stub = host();
    await expect(dispatchCommand(stub, { type: 'set_model', provider: 'p', modelId: 'gone' }))
      .rejects.toThrow('Model not offered');
    expect(stub.writes).toEqual([]);
  });

  test('the access tier is adopted before the command runs', async () => {
    const stub = host();
    await dispatchCommand(stub, { type: 'get_state', accessMode: 'yolo' });
    expect(stub.modes).toEqual(['yolo']);
  });

  test('get_commands answers the agent’s own list', async () => {
    const stub = host();
    expect(await dispatchCommand(stub, { type: 'get_commands' })).toEqual({ commands: [{ name: 'clear' }] });
  });
});
