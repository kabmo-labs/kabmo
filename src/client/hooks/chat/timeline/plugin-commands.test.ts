/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The plugin-command interception: the popup offers a `/command` row, so the
 * send path must answer the same token locally. The failures pinned here are
 * the two halves of that promise — a registered command that does NOT run (the
 * draft would reach the model as literal text) and an unregistered one that
 * DOES (the user's real prompt would be swallowed and never sent).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { CommandActionContext } from '@kabmo-labs/kabmo-sdk';
import { registerListSlot, resetListSlots } from '@/client/lib/plugins/list-slots';
import { setPluginContext } from '@/client/lib/plugins/context';
import { dispatchPluginCommand } from '@/client/hooks/chat/timeline/plugin-commands';

interface Ran {
  args: string;
  sessionId: string | null;
  workspacePath: string | null;
}

const ran: Ran[] = [];

function register(pluginId: string, command: string, run?: (context: CommandActionContext) => void) {
  return registerListSlot(pluginId, 'commandPaletteAction', {
    id: `${command}-row`,
    command,
    description: `${command} does a thing`,
    run: (context: CommandActionContext) => {
      ran.push({ args: context.args, sessionId: context.sessionId, workspacePath: context.workspacePath });
      run?.(context);
    },
  });
}

beforeEach(() => {
  ran.length = 0;
  resetListSlots();
  setPluginContext(null, null);
});

afterEach(() => {
  resetListSlots();
  setPluginContext(null, null);
});

describe('dispatchPluginCommand', () => {
  test('a registered command runs with its args and the published context', () => {
    register('deploy', 'deploy');
    setPluginContext('session-1', '/repo');

    expect(dispatchPluginCommand('/deploy prod --force')).toBe(true);
    expect(ran).toEqual([{ args: 'prod --force', sessionId: 'session-1', workspacePath: '/repo' }]);
  });

  test('a bare command runs with empty args', () => {
    register('deploy', 'deploy');
    expect(dispatchPluginCommand('/deploy')).toBe(true);
    expect(ran).toEqual([{ args: '', sessionId: null, workspacePath: null }]);
  });

  test('the command name matches case-insensitively, and the colon form is the same invocation', () => {
    register('deploy', 'Deploy');
    expect(dispatchPluginCommand('/DEPLOY prod')).toBe(true);
    expect(dispatchPluginCommand('/deploy:prod')).toBe(true);
    expect(ran.map((entry) => entry.args)).toEqual(['prod', 'prod']);
  });

  test('an unknown token is not consumed', () => {
    register('deploy', 'deploy');
    expect(dispatchPluginCommand('/status')).toBe(false);
    expect(ran).toEqual([]);
  });

  test('a non-slash draft is not consumed, even when it contains a command name', () => {
    register('deploy', 'deploy');
    expect(dispatchPluginCommand('run the /deploy script')).toBe(false);
    expect(dispatchPluginCommand('')).toBe(false);
    expect(ran).toEqual([]);
  });

  test('two plugins both dispatch, by their own command names', () => {
    register('alpha', 'alpha-cmd');
    register('beta', 'beta-cmd');

    expect(dispatchPluginCommand('/alpha-cmd one')).toBe(true);
    expect(dispatchPluginCommand('/beta-cmd two')).toBe(true);
    expect(ran.map((entry) => entry.args)).toEqual(['one', 'two']);
  });

  test('a disposed registration stops dispatching', () => {
    const dispose = register('deploy', 'deploy');
    dispose();
    expect(dispatchPluginCommand('/deploy')).toBe(false);
    expect(ran).toEqual([]);
  });

  test('a rejecting run does not escape as an unhandled rejection', async () => {
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { errors.push(args[0]); };
    try {
      register('deploy', 'deploy', () => { throw new Error('boom'); });
      expect(dispatchPluginCommand('/deploy')).toBe(true);
      await Promise.resolve();
      await Promise.resolve();
      expect(errors.length).toBe(1);
    } finally {
      console.error = original;
    }
  });
});
