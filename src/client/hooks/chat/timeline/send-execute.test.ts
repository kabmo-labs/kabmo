/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/** The send path's first half: composing and executing a send —
 * optimistic bubble, generating flag, queue fallback, and follow-up delivery.
 * The steer/interrupt cases live in `send.test.ts` and the refusal-report
 * cases in `send-refusal.test.ts`; the harness all three share is
 * `send.test-util.ts`. Every file stays under the repo's 350-line ceiling. */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  act,
  installDomGlobals,
  makeSendHarness,
  originalFetch,
  requests,
  restoreDomGlobals,
  stubComposerFetch,
} from '@/client/hooks/chat/timeline/send.test-util';

beforeAll(() => {
  installDomGlobals();
});
afterAll(() => {
  restoreDomGlobals();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('executeSend', () => {
  beforeEach(() => {
    requests.length = 0;
    stubComposerFetch();
  });

  test('appends the user row plus AI placeholder and persists only the user row', async () => {
    const h1 = makeSendHarness();
    await act(async () => {
      await h1.sends.executeSend('hello', []);
    });
    expect(h1.state.messages.map((m) => m.role)).toEqual(['user', 'ai']);
    const [user, ai] = h1.state.messages;
    expect(user?.id).toMatch(/^msg-\d+-user$/);
    expect(ai?.id).toMatch(/^msg-\d+-ai$/);
    expect(user?.content).toBe('hello');
    expect(ai?.content).toBe('');
    expect(typeof user?.startedAt).toBe('number');
    expect(user?.startedAt).toBe(ai?.startedAt);
    expect(h1.persisted).toEqual([[user]]);
  });

  test('delivers the prompt to the omp agent with the live access mode', async () => {
    const h1 = makeSendHarness();
    h1.deps.accessModeRef.current = 'write';
    await act(async () => {
      await h1.sends.executeSend('hello', []);
    });
    expect(h1.agent.calls.prompts).toEqual([{ text: 'hello', images: undefined, options: { accessMode: 'write' } }]);
    expect(h1.generating).toEqual([true]);
  });

  test('a replayed queued item re-applies its model and thinking level first', async () => {
    const h1 = makeSendHarness();
    await act(async () => {
      await h1.sends.executeSend('queued text', [], {
        model: { provider: 'anthropic', modelId: 'claude', thinkingLevel: 'high', accessMode: 'yolo' },
      });
    });
    expect(h1.agent.calls.models).toEqual([['anthropic', 'claude']]);
    expect(h1.agent.calls.levels).toEqual(['high']);
    expect(h1.agent.calls.prompts[0]?.options).toEqual({ accessMode: 'yolo' });
  });

  test("thinking level 'auto' on a queued item leaves omp's level untouched", async () => {
    const h1 = makeSendHarness();
    await act(async () => {
      await h1.sends.executeSend('queued text', [], {
        model: { provider: 'anthropic', modelId: 'claude', thinkingLevel: 'auto', accessMode: 'always-ask' },
      });
    });
    expect(h1.agent.calls.levels).toEqual([]);
  });

  test('a stashed composer pick is flushed before a plain send', async () => {
    const deferredPick = { current: { provider: 'openai', modelId: 'gpt', thinkingLevel: 'low' } };
    const h1 = makeSendHarness({ deferredPick });
    await act(async () => {
      await h1.sends.executeSend('hello', []);
    });
    expect(h1.agent.calls.models).toEqual([['openai', 'gpt']]);
    expect(h1.agent.calls.levels).toEqual(['low']);
    expect(deferredPick.current).toBeNull();
  });

  test('a failed send rolls both bubbles back and stops generating', async () => {
    const h1 = makeSendHarness({ agent: { sendPromptOk: false } });
    await act(async () => {
      await h1.sends.executeSend('hello', []);
    });
    expect(h1.state.messages).toEqual([]);
    expect(h1.deps.aiPlaceholderIdRef.current).toBeNull();
    expect(h1.generating).toEqual([true, false]);
  });

  test('a TUI-only command never reaches the agent', async () => {
    const h1 = makeSendHarness();
    await act(async () => {
      await h1.sends.executeSend('/hotkeys', []);
    });
    expect(h1.agent.calls.prompts).toEqual([]);
    expect(h1.state.messages).toHaveLength(1);
    expect(h1.state.messages[0]?.notice).toContain('/hotkeys');
  });

  test('a fresh chat spawns the session, seeds its identity, and adopts the id', async () => {
    const h1 = makeSendHarness({
      isOmpSession: false,
      sessionId: 'new-1',
      folders: [{ id: 4, name: 'demo', project_path: '/tmp/demo' }],
      selectedFolderId: 4,
      agent: { spawnResult: { sessionId: 'uuid-9', model: { provider: 'x', modelId: 'y' } } },
    });
    h1.deps.pendingComposerModelRef.current = { provider: 'x', modelId: 'y' };
    h1.deps.pendingThinkingLevelRef.current = 'high';
    await act(async () => {
      await h1.sends.executeSend('first prompt', []);
    });
    expect(h1.agent.calls.newPrompts[0]?.cwd).toBe('/tmp/demo');
    expect(h1.agent.calls.newPrompts[0]?.options).toMatchObject({
      model: { provider: 'x', modelId: 'y' },
      thinkingLevel: 'high',
      modes: { plan: true, goal: false },
    });
    expect(h1.adoptedSessionIdRef.current).toBe('uuid-9');
    expect(h1.seeds).toEqual([{ model: { provider: 'x', modelId: 'y' }, thinkingLevel: 'high' }]);
    expect(h1.spawnSelectionRef.current).toBeNull();
    expect(h1.params).toEqual(['sessionId=uuid-9']);
  });
});
