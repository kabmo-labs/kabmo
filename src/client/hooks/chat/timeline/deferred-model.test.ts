/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A composer model/thinking pick made while a turn is streaming must not reach
 * the live session: omp applies `set_model` to the RUNNING turn, so pushing it
 * immediately re-targets the answer in flight (verified against omp's RPC
 * handler and by driving a live session — one run answered its first turn on
 * the old model and its next turns on the new one).
 *
 * The pick is held and pushed right before the next prompt instead. These run
 * against a real DOM (happy-dom) because the hooks are Preact hooks: the
 * modules below are imported inside `beforeAll`, after those globals exist,
 * since Preact binds its environment at evaluation time.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { h as PreactH, render as PreactRender } from 'preact';
import type { act as PreactAct } from 'preact/test-utils';
import type { useChatTimelineActions as UseChatTimelineActions, ChatTimelineActionsResult } from '@/client/hooks/chat/timeline/actions';
import type { ComposerModelPick, DeferredModelStore } from '@/client/hooks/chat/timeline/deferred-model';
import { flushDeferredPick } from '@/client/hooks/chat/timeline/deferred-model';
import type { OmpAgentHandle } from '@/shared/types';

let useChatTimelineActions: typeof UseChatTimelineActions;
let h: typeof PreactH;
let render: typeof PreactRender;
let act: typeof PreactAct;

let container: HTMLElement;

interface Harness {
  calls: string[];
  deferred: { current: ComposerModelPick | null };
  actions: ChatTimelineActionsResult;
}

/** A recording agent handle plus the calls it received. */
function makeAgent() {
  const calls: string[] = [];
  const agent = {
    setModel: async (provider: string, modelId: string) => { calls.push(`set_model:${provider}/${modelId}`); },
    setThinkingLevel: async (level: string) => { calls.push(`set_thinking_level:${level}`); },
  } as unknown as OmpAgentHandle;
  return { calls, agent };
}

/** Mounts the real hook and records every model/thinking RPC it pushes. */
async function mountActions(isGenerating: boolean, stashed: ComposerModelPick | null): Promise<Harness> {
  const deferred: { current: ComposerModelPick | null } = { current: stashed };
  const { calls, agent } = makeAgent();

  const captured: ChatTimelineActionsResult[] = [];
  const Probe = () => {
    captured.push(useChatTimelineActions({
      inputValue: '',
      setInputValue: () => {},
      setInputAttachments: () => {},
      isGenerating,
      chatRunning: isGenerating,
      isOmpSession: true,
      sessionId: '01a0ca36-f3be-7252-a95c-3d45d180c539',
      folders: [],
      selectedFolderId: null,
      appSettings: {},
      messageQueue: [],
      enqueueMessage: () => {},
      removeMessage: () => {},
      executeSend: async () => ({ ok: true, busy: false }),
      steerOmpAgent: async () => ({ ok: true, busy: false }),
      ompAgent: agent,
      abortControllerRef: { current: null },
      setGenerating: () => {},
      stopHoldRef: { current: false },
      persistMessages: () => {},
      setLocalMessages: () => {},
      localMessagesRef: { current: [] },
      pendingComposerModelRef: { current: null },
      pendingThinkingLevelRef: { current: null },
      composerModelRef: { current: null },
      deferredComposerPickRef: deferred,
      accessModeRef: { current: 'yolo' },
      setSearchParams: () => {},
      reportActionError: () => {},
    }));
    return null;
  };
  await act(async () => {
    render(h(Probe, {}), container);
  });
  // The handlers fire-and-forget their RPC, so let the microtask chain settle.
  for (let i = 0; i < 10; i++) await Promise.resolve();
  return { calls, deferred, actions: captured[captured.length - 1] };
}

/** The DOM surface this file installs for Preact to render into. */
function domGlobals(win: Window): Record<string, unknown> {
  return {
    window: win,
    document: win.document,
    navigator: win.navigator,
    Node: win.Node,
    Element: win.Element,
    HTMLElement: win.HTMLElement,
  };
}

const installed: Record<string, unknown> = {};
const displaced: Record<string, unknown> = {};

beforeAll(async () => {
  const win = new Window({ url: 'http://localhost' });
  for (const [key, value] of Object.entries(domGlobals(win))) {
    displaced[key] = (globalThis as Record<string, unknown>)[key];
    installed[key] = value;
    (globalThis as Record<string, unknown>)[key] = value;
  }
  ({ useChatTimelineActions } = await import('@/client/hooks/chat/timeline/actions'));
  ({ h, render } = await import('preact'));
  ({ act } = await import('preact/test-utils'));
});

// Every test file shares one process, so the globals go back the way they were.
afterAll(() => {
  for (const key of Object.keys(installed)) {
    if (displaced[key] === undefined) delete (globalThis as Record<string, unknown>)[key];
    else (globalThis as Record<string, unknown>)[key] = displaced[key];
  }
});

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

describe('composer model/thinking picks during a stream', () => {
  test('a mid-stream model pick sends no RPC and is stashed', async () => {
    const { calls, deferred, actions } = await mountActions(true, null);
    actions.handleModelChange('kenari', 'deepseek-v4-pro');

    expect(calls).toEqual([]);
    expect(deferred.current).toEqual({ provider: 'kenari', modelId: 'deepseek-v4-pro' });
  });

  test('a mid-stream thinking pick sends no RPC and is stashed', async () => {
    const { calls, deferred, actions } = await mountActions(true, null);
    actions.handleThinkingLevelChange('high');

    expect(calls).toEqual([]);
    expect(deferred.current).toEqual({ thinkingLevel: 'high' });
  });

  test('model then thinking mid-stream both survive to the next prompt', async () => {
    const { calls, deferred, actions } = await mountActions(true, null);
    actions.handleModelChange('kenari', 'deepseek-v4-pro');
    actions.handleThinkingLevelChange('max');

    expect(calls).toEqual([]);
    expect(deferred.current).toEqual({ provider: 'kenari', modelId: 'deepseek-v4-pro', thinkingLevel: 'max' });
  });

  test('an idle pick reaches the session immediately', async () => {
    const { calls, deferred, actions } = await mountActions(false, null);
    actions.handleModelChange('kenari', 'deepseek-v4-pro');
    actions.handleThinkingLevelChange('high');
    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(calls).toEqual(['set_model:kenari/deepseek-v4-pro', 'set_thinking_level:high']);
    expect(deferred.current).toBeNull();
  });

  test('an idle model pick leaves a stashed thinking level pending', async () => {
    const { calls, deferred, actions } = await mountActions(false, { thinkingLevel: 'high' });
    actions.handleModelChange('kenari', 'deepseek-v4-pro');
    for (let i = 0; i < 10; i++) await Promise.resolve();

    // The level was never applied here, so it must still wait for the next
    // prompt rather than being dropped or pushed now.
    expect(calls).toEqual(['set_model:kenari/deepseek-v4-pro']);
    expect(deferred.current).toEqual({ thinkingLevel: 'high' });
  });

  test("'auto' thinking is never pushed onto the live session", async () => {
    const { calls, deferred, actions } = await mountActions(false, null);
    actions.handleThinkingLevelChange('auto');

    expect(calls).toEqual([]);
    expect(deferred.current).toBeNull();
  });
});

describe('flushing a pick onto the session', () => {
  test('pushes the stashed model and thinking level, then clears the slot', async () => {
    const { calls, agent } = makeAgent();
    const store: DeferredModelStore = { current: { provider: 'kenari', modelId: 'deepseek-v4-pro', thinkingLevel: 'max' } };

    await flushDeferredPick(agent, store);

    expect(calls).toEqual(['set_model:kenari/deepseek-v4-pro', 'set_thinking_level:max']);
    expect(store.current).toBeNull();
  });

  test("a stashed 'auto' level is not pushed as a concrete level", async () => {
    const { calls, agent } = makeAgent();
    const store: DeferredModelStore = { current: { provider: 'kenari', modelId: 'deepseek-v4-pro', thinkingLevel: 'auto' } };

    await flushDeferredPick(agent, store);

    expect(calls).toEqual(['set_model:kenari/deepseek-v4-pro']);
    expect(store.current).toBeNull();
  });

  test('flushing an empty slot sends nothing', async () => {
    const { calls, agent } = makeAgent();
    const store: DeferredModelStore = { current: null };

    await flushDeferredPick(agent, store);

    expect(calls).toEqual([]);
  });
});
