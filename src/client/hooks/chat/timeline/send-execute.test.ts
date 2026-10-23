/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/** The send path's first half: composing and executing a send —
 * optimistic bubble, generating flag, queue fallback, and follow-up delivery.
 * Split verbatim from `send.test.ts` so both files stay under the repo's
 * 350-line ceiling; the head file keeps the steer/interrupt cases. */

import { afterEach, beforeAll, afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import type { ChatMessageData, OmpAgentHandle } from '@/shared/types';
import {
  useChatTimelineSend,
  type ChatTimelineSendDeps,
  type ChatTimelineSendResult,
} from '@/client/hooks/chat/timeline/send';
import {
  type SessionSeed,
} from '@/client/hooks/chat/timeline/session-load';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'CustomEvent'] as const;
/** The runner's own globals, restored on teardown so later files still have them. */
const native: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

/** The runner's own fetch, reached through `Bun` so a stub leaked onto the global cannot be mistaken for it. */
const originalFetch = Bun.fetch;
let container: HTMLElement;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in native)) native[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});
afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (native[key] === undefined) delete target[key];
    else target[key] = native[key];
  }
});
afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  globalThis.fetch = originalFetch;
});

/** Composer autocomplete reads; answer with "no agents" so prompts pass through. */
function stubComposerFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), method: init?.method ?? 'GET', body: init?.body === undefined ? null : String(init.body) });
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

const requests: Array<{ url: string; method: string; body: string | null }> = [];

function makeMessages(): { messages: ChatMessageData[]; setLocalMessages: ChatTimelineSendDeps['setLocalMessages'] } {
  const messages: ChatMessageData[] = [];
  return {
    messages,
    setLocalMessages: (next) => {
      const resolved = typeof next === 'function' ? next(messages) : next;
      messages.splice(0, messages.length, ...resolved);
    },
  };
}

/** Everything the send path pushed onto the agent, plus the canned outcomes. */
interface AgentCalls {
  prompts: Array<{ text: string; images: unknown; options: unknown }>;
  newPrompts: Array<{ text: string; cwd: string; options: unknown }>;
  models: Array<[string, string]>;
  levels: string[];
  interrupts: Array<{ text: string; images: unknown }>;
  sendPromptOk: boolean;
  /** omp's typed mid-turn refusal (nothing delivered, safe to queue). */
  sendPromptBusy: boolean;
  spawnResult: { sessionId: string; model?: { provider: string; modelId: string } } | null;
}

interface AgentRecorder {
  calls: AgentCalls;
  agent: OmpAgentHandle;
}

function makeAgent(overrides: Partial<AgentCalls> = {}): AgentRecorder {
  const calls: AgentCalls = {
    prompts: [],
    newPrompts: [],
    models: [],
    levels: [],
    interrupts: [],
    sendPromptOk: true,
    sendPromptBusy: false,
    spawnResult: null,
    ...overrides,
  };
  const agent = {
    sendPrompt: async (text: string, images: unknown, options: unknown) => {
      calls.prompts.push({ text, images, options });
      return { ok: calls.sendPromptOk, busy: calls.sendPromptBusy };
    },
    sendNewPrompt: async (text: string, cwd: string, _images: unknown, options: unknown) => {
      calls.newPrompts.push({ text, cwd, options });
      return calls.spawnResult;
    },
    steerOmpRun: async (text: string, images: unknown) => {
      calls.interrupts.push({ text, images });
      return { ok: calls.sendPromptOk, busy: false };
    },
    setModel: async (provider: string, modelId: string) => {
      calls.models.push([provider, modelId]);
    },
    setThinkingLevel: async (level: string) => {
      calls.levels.push(level);
    },
  } as unknown as OmpAgentHandle;
  return { calls, agent };
}

interface SendHarness {
  sends: ChatTimelineSendResult;
  deps: ChatTimelineSendDeps;
  agent: AgentRecorder;
  state: { messages: ChatMessageData[] };
  persisted: ChatMessageData[][];
  generating: boolean[];
  drafts: string[];
  params: string[];
  seeds: SessionSeed[];
  spawnSelectionRef: { current: { plan: boolean; goal: boolean } | null };
  adoptedSessionIdRef: { current: string | null };
}

function makeSendHarness(options: {
  isOmpSession?: boolean;
  folders?: any[];
  selectedFolderId?: number | null;
  sessionId?: string | null;
  agent?: Partial<AgentCalls> | AgentRecorder;
  deferredPick?: { current: any };
} = {}): SendHarness {
  const { messages, setLocalMessages } = makeMessages();
  // `options.agent` is either overrides for the recorder's `AgentCalls` or
  // the finished recorder itself; the two forms are told apart by shape.
  const agent: AgentRecorder =
    options.agent && 'calls' in options.agent
      ? options.agent
      : makeAgent(options.agent);
  const persisted: ChatMessageData[][] = [];
  const generating: boolean[] = [];
  const drafts: string[] = [];
  const params: string[] = [];
  const seeds: SessionSeed[] = [];
  const spawnSelectionRef = { current: { plan: true, goal: false } };
  const spawnWorktreeRef = { current: null as string | null };
  const adoptedSessionIdRef = { current: null };
  const deps: ChatTimelineSendDeps = {
    folders: options.folders ?? [],
    selectedFolderId: options.selectedFolderId ?? null,
    sessionId: options.sessionId === undefined ? 'sess-1' : options.sessionId,
    isOmpSession: options.isOmpSession ?? true,
    appSettings: {},
    ompAgent: agent.agent,
    setLocalMessages,
    persistMessages: (msgs) => {
      persisted.push(msgs);
    },
    setGenerating: (v) => {
      generating.push(v);
    },
    setGeneratingVerb: () => {},
    scrollToBottom: () => {},
    jumpToBottom: () => {},
    aiPlaceholderIdRef: { current: null },
    adoptedSessionIdRef,
    optimisticUserIdRef: { current: null },
    pendingUserDisplaysRef: { current: [] },
    seedSession: (seed) => {
      seeds.push(seed);
    },
    pendingComposerModelRef: { current: null },
    pendingThinkingLevelRef: { current: null },
    deferredComposerPickRef: options.deferredPick ?? { current: null },
    accessModeRef: { current: 'always-ask' },
    spawnSelectionRef,
    spawnWorktreeRef,
    abortControllerRef: { current: null },
    setInputValue: (v) => {
      drafts.push(v);
    },
    setSearchParams: (fn) => {
      params.push(fn(new URLSearchParams('sessionId=new-1')).toString());
    },
  };
  let sends: ChatTimelineSendResult | null = null;
  const Probe = () => {
    sends = useChatTimelineSend(deps);
    return h('div', { id: 'send-probe' });
  };
  container ??= document.body.appendChild(document.createElement('div'));
  render(h(Probe, {}), container as HTMLElement);
  return {
    sends: sends as unknown as ChatTimelineSendResult,
    deps,
    agent,
    state: { messages },
    persisted,
    generating,
    drafts,
    params,
    seeds,
    spawnSelectionRef,
    adoptedSessionIdRef,
  };
}


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
