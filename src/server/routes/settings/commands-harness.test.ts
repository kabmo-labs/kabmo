/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The composer's `/` pool for a live ACP chat.
 *
 * The route used to fall through to omp's utility catalog whenever the agent's
 * own list was empty, so a chat whose agent published nothing was offered
 * `/plan`, `/clear`, … — commands from a different agent's vocabulary.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { loader } from '@/server/routes/settings/commands';
import { registerAcpSession } from '@/server/lib/harness/register.server';
import { claimHarness } from '@/server/lib/harness/registry';
import type { HarnessSession } from '@/server/lib/harness/session';

type Command = { name: string; description?: string };

/** Register a fake ACP session the route's `getLiveSession` lookup will find. */
function registerAgent(id: string, commands: Command[]): () => void {
  let release: (() => void) | null = null;
  const session = {
    sessionId: id,
    harness: 'claude',
    sessionFile: '',
    cwd: '/tmp',
    isStreaming: false,
    isPromptRunning: false,
    runModel: null,
    capabilities: {},
    configOptions: [],
    isAlive: () => true,
    isRunning: () => false,
    isBusy: () => false,
    send: async (command: Record<string, unknown>) =>
      command.type === 'get_commands' ? { commands } : {},
    getPendingUiDialogs: () => [],
    resolvePendingUiDialog: () => {},
    onEvent: () => () => {},
    emit: () => {},
    destroy: () => {},
    destroyAndWait: async () => {},
    onDestroy: (callback: () => void) => {
      release = callback;
    },
  };
  registerAcpSession(session as unknown as HarnessSession, id);
  claimHarness(session as unknown as HarnessSession, 'claude');
  return () => release?.();
}

function load(sessionId: string): Promise<Response> {
  return loader({
    request: new Request(`http://localhost/api/settings/commands?sessionId=${sessionId}`),
    params: {},
  } as never) as Promise<Response>;
}

beforeEach(async () => {
  delete Bun.env.MOCK;
  await isolateDb();
});

afterEach(async () => {
  await releaseDb();
});

describe('commands loader on a live ACP chat', () => {
  test('an agent that published nothing is empty, not omp’s catalog', async () => {
    const release = registerAgent('acp-no-commands', []);
    try {
      const body = (await (await load('acp-no-commands')).json()) as { commands: Command[] };
      expect(body.commands).toEqual([]);
    } finally {
      release();
    }
  });

  test("the agent's own commands lead the list", async () => {
    const release = registerAgent('acp-commands', [{ name: 'clear', description: 'Clear the conversation' }]);
    try {
      const body = (await (await load('acp-commands')).json()) as { commands: Command[] };
      expect(body.commands[0]).toMatchObject({ name: 'clear' });
    } finally {
      release();
    }
  });
});
