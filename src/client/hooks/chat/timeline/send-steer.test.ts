/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/** The send path's second half: steering a running turn. Split verbatim
 * from `send.test.ts` so both files stay under the repo's 350-line ceiling;
 * the executeSend cases live in `send-execute.test.ts`. */

import { afterEach, beforeAll, afterAll, describe, expect, test } from 'bun:test';
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
  /** Messages handed to the running turn (omp `steer`). */
  steers: Array<{ text: string; images: unknown }>;
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
    steers: [],
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
      calls.steers.push({ text, images });
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
    reportActionError: () => {},
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

describe('steerOmpAgent', () => {
  test('steers the running turn and keeps the draft on failure', async () => {
    const h1 = makeSendHarness({ agent: { sendPromptOk: false } });
    await act(async () => {
      await h1.sends.steerOmpAgent('steer me', []);
    });
    expect(h1.agent.calls.steers).toEqual([{ text: 'steer me', images: undefined }]);
    expect(h1.drafts).toEqual(['steer me']);
  });

  test('a successful steer leaves the composer alone', async () => {
    const h1 = makeSendHarness();
    await act(async () => {
      await h1.sends.steerOmpAgent('steer me', []);
    });
    expect(h1.drafts).toEqual([]);
  });
});
