/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The shared harness behind the two halves of the send path's test suite
 * (`send-execute.test.ts` for composing/executing, `send-refusal.test.ts` for
 * how a REFUSAL is reported).
 *
 * Split out of the test files because both need the same recorder and the same
 * mounted `useChatTimelineSend` probe, and because copying it into a second
 * file is how the two ends drift — the recorder is what a case asserts on, so
 * a copy that lost a field would make a test pass for the wrong reason.
 */

import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import type { ChatMessageData, OmpAgentHandle } from '@/shared/types';
import type { ArmedGoal } from '@/shared/lib/omp/mode/actions';
import {
  useChatTimelineSend,
  type ChatTimelineSendDeps,
  type ChatTimelineSendResult,
} from '@/client/hooks/chat/timeline/send';
import type { SessionSeed } from '@/client/hooks/chat/timeline/session-shapes';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'CustomEvent'] as const;

let installed: { restore: () => void } | null = null;
/** How many files currently want the DOM installed. */
let holders = 0;

/** Put happy-dom's globals in place, remembering the runner's own. */
function install(): void {
  const native: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    native[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  installed = {
    restore: () => {
      for (const key of DOM_GLOBALS) {
        if (native[key] === undefined) delete target[key];
        else target[key] = native[key];
      }
      installed = null;
    },
  };
}

/**
 * Give the file a DOM, as a HOLD.
 *
 * REFERENCE-COUNTED, because several files share this harness and `bun test`
 * runs them in one process: `send-execute.test.ts` and `send-refusal.test.ts`
 * both install in `beforeAll` and restore in `afterAll`. With a plain
 * installed/not-installed flag the second file's install was a no-op and the
 * FIRST file's restore then removed the DOM from under it — measured on the
 * Windows gate, where all eight `executeSend` cases failed with
 * `ReferenceError: document is not defined` while the same file passed alone.
 * The globals go only when the last holder lets go.
 */
export function installDomGlobals(): void {
  holders += 1;
  ensureDom();
}

export function restoreDomGlobals(): void {
  if (holders === 0) return;
  holders -= 1;
  if (holders === 0) installed?.restore();
}

/**
 * Make sure the DOM really is on `globalThis`, whatever the flag says.
 *
 * The flag alone is not trustworthy. `pristine-globals.ts` is a SECOND manager
 * of the same names, and its `restoreDomGlobals` DELETES a global whose pristine
 * value was undefined — which is exactly `document` under `bun test`. A file
 * that uses that helper while this harness held the DOM therefore strips it and
 * leaves `installed` pointing at a restore for globals that are already gone.
 * Measured on the Windows gate: all eight `executeSend` cases failed with
 * `ReferenceError: document is not defined` from `makeSendHarness`, while the
 * same file passed alone. Checking the global is what makes the two managers
 * safe in either order.
 */
function ensureDom(): void {
  if (installed && typeof (globalThis as Record<string, unknown>).document !== 'undefined') return;
  installed = null;
  install();
}

/** The runner's own fetch, reached through `Bun` so a leaked stub cannot be mistaken for it. */
export const originalFetch = Bun.fetch;

export const requests: Array<{ url: string; method: string; body: string | null }> = [];

/** Composer autocomplete reads; answer with "no agents" so prompts pass through. */
export function stubComposerFetch(): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), method: init?.method ?? 'GET', body: init?.body === undefined ? null : String(init.body) });
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

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
export interface AgentCalls {
  prompts: Array<{ text: string; images: unknown; options: unknown }>;
  newPrompts: Array<{ text: string; cwd: string; options: unknown }>;
  models: Array<[string, string]>;
  levels: string[];
  interrupts: Array<{ text: string; images: unknown }>;
  sendPromptOk: boolean;
  /** omp's typed mid-turn refusal (nothing delivered, safe to queue). */
  sendPromptBusy: boolean;
  /** The server-supplied reason, when the send was refused. */
  sendPromptError: string | undefined;
  /** The reason a fresh spawn failed, when `spawnResult` is null. */
  spawnError?: string;
  spawnResult: { sessionId: string; model?: { provider: string; modelId: string }; harness?: string } | null;
}

export interface AgentRecorder {
  calls: AgentCalls;
  agent: OmpAgentHandle;
}

export function makeAgent(overrides: Partial<AgentCalls> = {}): AgentRecorder {
  const calls: AgentCalls = {
    prompts: [],
    newPrompts: [],
    models: [],
    levels: [],
    interrupts: [],
    sendPromptOk: true,
    sendPromptBusy: false,
    sendPromptError: undefined,
    spawnResult: null,
    ...overrides,
  };
  const agent = {
    sendPrompt: async (text: string, images: unknown, options: unknown) => {
      calls.prompts.push({ text, images, options });
      return { ok: calls.sendPromptOk, busy: calls.sendPromptBusy, error: calls.sendPromptError };
    },
    sendNewPrompt: async (text: string, cwd: string, _images: unknown, options: unknown) => {
      calls.newPrompts.push({ text, cwd, options });
      return calls.spawnResult
        ? { ok: true as const, session: calls.spawnResult }
        : { ok: false as const, error: calls.spawnError ?? 'spawn failed' };
    },
    steerOmpRun: async (text: string, images: unknown) => {
      calls.interrupts.push({ text, images });
      return { ok: calls.sendPromptOk, busy: false, error: calls.sendPromptError };
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

export interface SendHarness {
  sends: ChatTimelineSendResult;
  deps: ChatTimelineSendDeps;
  agent: AgentRecorder;
  state: { messages: ChatMessageData[] };
  persisted: ChatMessageData[][];
  generating: boolean[];
  drafts: string[];
  /** Every message the send path REPORTED (the toast channel). */
  reported: string[];
  params: string[];
  seeds: SessionSeed[];
  spawnSelectionRef: { current: { plan: boolean; goal: boolean } | null };
  /** The armed goal, so a case can arm one and read what the send consumed. */
  goalArmRef: { current: ArmedGoal | null };
  adoptedSessionIdRef: { current: string | null };
}

export function makeSendHarness(options: {
  folders?: unknown[];
  selectedFolderId?: number | null;
  sessionId?: string | null;
  isOmpSession?: boolean;
  agent?: AgentRecorder | Partial<AgentCalls>;
  deferredPick?: { current: unknown };
} = {}): SendHarness {
  // Ensure, never HOLD: a case's DOM comes from its file's `beforeAll`, and
  // counting here would leave the globals installed for the whole process.
  ensureDom();
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
  const reported: string[] = [];
  const params: string[] = [];
  const seeds: SessionSeed[] = [];
  const spawnSelectionRef = { current: { plan: true, goal: false } };
  /** No goal armed unless a case arms one. */
  const goalArmRef: { current: ArmedGoal | null } = { current: null };
  const disarmGoal = () => { goalArmRef.current = null; };
  const spawnWorktreeRef = { current: null as string | null };
  const adoptedSessionIdRef = { current: null };
  const deps: ChatTimelineSendDeps = {
    folders: (options.folders ?? []) as ChatTimelineSendDeps['folders'],
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
    pendingHarnessRef: { current: null },
    deferredComposerPickRef: (options.deferredPick ?? { current: null }) as ChatTimelineSendDeps['deferredComposerPickRef'],
    accessModeRef: { current: 'always-ask' },
    spawnSelectionRef,
    goalArmRef,
    disarmGoal,
    spawnWorktreeRef,
    abortControllerRef: { current: null },
    setInputValue: (v) => {
      drafts.push(v);
    },
    reportActionError: (message: string) => {
      reported.push(message);
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
  const container = document.body.appendChild(document.createElement('div'));
  render(h(Probe, {}), container as HTMLElement);
  return {
    sends: sends as unknown as ChatTimelineSendResult,
    deps,
    agent,
    state: { messages },
    persisted,
    generating,
    drafts,
    reported,
    params,
    seeds,
    spawnSelectionRef,
    goalArmRef,
    adoptedSessionIdRef,
  };
}

export { act };