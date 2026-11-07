/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A reopened ACP chat must name the model it is ACTUALLY running.
 *
 * A non-omp ACP agent writes no transcript Kabmo can read, and its stored row
 * carries no model. Before this, the composer fell back to omp's catalog and
 * claimed a model the agent had never heard of; the live session's own selector
 * (or, after a restart, the last run's stream row) is the only truthful source.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { loader } from '@/server/routes/chat/session';
import { registerAcpSession } from '@/server/lib/harness/register.server';
import { claimHarness } from '@/server/lib/harness/registry';
import type { HarnessSession } from '@/server/lib/harness/session';

function registerAgent(id: string, state: Record<string, unknown>): () => void {
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
    send: async (command: Record<string, unknown>) => (command.type === 'get_state' ? state : {}),
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
    request: new Request(`http://localhost/api/chat/${sessionId}`),
    params: { sessionId },
  } as never) as Promise<Response>;
}

beforeEach(async () => {
  delete Bun.env.MOCK;
  await isolateDb();
});

afterEach(async () => {
  await releaseDb();
});

describe('chat session loader on a live ACP chat', () => {
  test('reports the session model and thinking level from get_state', async () => {
    const release = registerAgent('acp-live-chat', {
      model: { provider: 'claude', id: 'opus' },
      thinkingLevel: 'high',
    });
    try {
      const body = (await (await load('acp-live-chat')).json()) as {
        session: { model?: { provider: string; modelId: string }; thinkingLevel?: string };
      };
      expect(body.session.model).toEqual({ provider: 'claude', modelId: 'opus' });
      expect(body.session.thinkingLevel).toBe('high');
    } finally {
      release();
    }
  });
});
