/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The harness both session-load suites share.
 *
 * Split out when the suite passed the per-file ceiling. It mounts the REAL
 * `useSessionLoad` through a `Probe` component and gates every `/api/chat/:id`
 * response, so a suite decides when — and with what — a fetch lands.
 *
 * The committed-history contract itself:
 *
 * While a run is live the timeline's rows are the STREAM's, and a committed
 * fetch is a lagging snapshot: for a fresh spawn there may be no transcript on
 * disk at all (omp buffers its writes until the first assistant message
 * settles), and it never carries a segment still streaming. Applying one
 * mid-run cost the operator their own turn in both directions, measured on real
 * sessions:
 *
 *   - an empty payload EMPTIED the list, so the turn they had just sent
 *     vanished until a reload;
 *   - a payload carrying the file's own copy of that turn was merged UNDER the
 *     live rows, whose ids differ (`msg-…-user` vs the echoed id), so the turn
 *     rendered twice.
 *
 * Both shapes needed the same hole: the guard was keyed on the AI placeholder,
 * which the stream RELEASES at the first assistant `message_end` while the run
 * continues. These cases pin the run as the ownership signal, and pin the two
 * directions the guard must still let through when no run is live.
 */

import { afterAll, afterEach, beforeAll } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useCallback, useRef, useState } from 'preact/hooks';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import { useSessionLoad } from '@/client/hooks/chat/timeline/session-load';
import type { ChatMessageData } from '@/shared/types';

/** The runner's own fetch, reached through `Bun` so a leak is not mistaken for it. */
const originalFetch = Bun.fetch;

/** The optimistic bubble `executeSend` mounts for a locally sent turn. */
export const OPTIMISTIC_USER: ChatMessageData = { id: 'msg-1-user', role: 'user', content: 'halo', date: 'Today, 12:22 PM' };
/** The empty assistant row the stream fills. */
export const AI_PLACEHOLDER: ChatMessageData = { id: 'msg-2-ai', role: 'ai', content: '' };
/** The same turn as the transcript records it, under its own id. */
export const ECHOED_TURN: ChatMessageData = { id: 'omp-echo', role: 'user', content: 'halo' };

interface LoadGate {
  url: string;
  resolve: (body: unknown) => void;
}

export const gates: LoadGate[] = [];

/** One mount's observable state: what the timeline holds and what drives it. */
export interface ProbeApi {
  messages: ChatMessageData[];
  adoptedSessionIdRef: { current: string | null };
  setMessages: (next: ChatMessageData[]) => void;
  isGeneratingRef: { current: boolean };
  ownRunRef: { current: boolean };
  aiPlaceholderIdRef: { current: string | null };
  optimisticUserIdRef: { current: string | null };
  generatingCalls: boolean[];
}

export function makeApi(): ProbeApi {
  return {
    messages: [],
    adoptedSessionIdRef: { current: null },
    setMessages: () => {},
    isGeneratingRef: { current: false },
    ownRunRef: { current: false },
    aiPlaceholderIdRef: { current: null },
    optimisticUserIdRef: { current: null },
    generatingCalls: [],
  };
}

function Probe({ sessionId, api }: { sessionId: string | null; api: ProbeApi }) {
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const isGeneratingRef = useRef(false);
  const ownRunRef = useRef(false);
  const streamRunRef = useRef(false);
  const serverRunRef = useRef(false);
  const aiPlaceholderIdRef = useRef<string | null>(null);
  const optimisticUserIdRef = useRef<string | null>(null);
  const pendingUserDisplaysRef = useRef<{ sent: string; display: string }[]>([]);
  const metaRefreshedRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const jumpActiveRef = useRef(false);
  const jumpCountRef = useRef(0);
  // Stable across renders, like the timeline's own `setGenerating` throat: a
  // fresh identity would re-run the load effect on every render.
  const setGenerating = useCallback((v: boolean) => {
    isGeneratingRef.current = v;
    api.generatingCalls.push(v);
  }, [api]);

  api.messages = messages;
  api.setMessages = setMessages;
  api.isGeneratingRef = isGeneratingRef;
  api.ownRunRef = ownRunRef;
  api.aiPlaceholderIdRef = aiPlaceholderIdRef;
  api.optimisticUserIdRef = optimisticUserIdRef;

  const { adoptedSessionIdRef } = useSessionLoad({
    sessionId,
    setLocalMessages: setMessages,
    setGenerating,
    isGeneratingRef,
    ownRunRef,
    streamRunRef,
    serverRunRef,
    aiPlaceholderIdRef,
    optimisticUserIdRef,
    pendingUserDisplaysRef,
    cancelStreamingCoalescer: () => {},
    metaRefreshedRef,
    scrollRef,
    jumpActiveRef,
    jumpCountRef,
  });
  api.adoptedSessionIdRef = adoptedSessionIdRef;
  return null;
}

let container: HTMLElement | undefined;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterAll(() => {
  restoreDomGlobals();
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  container = undefined;
  gates.length = 0;
});

/** Stub the loader so the test decides when (and with what) the fetch lands. */
export function stubChatFetch(): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const { promise, resolve } = Promise.withResolvers<Response>();
    gates.push({ url, resolve: (body) => resolve(new Response(JSON.stringify(body))) });
    return promise;
  }) as typeof fetch;
}

/** Mount the real hook and let its session-load effect register its fetch. */
export async function mount(sessionId: string, api: ProbeApi): Promise<void> {
  container ??= document.body.appendChild(document.createElement('div'));
  await act(async () => {
    render(h(Probe, { sessionId, api }), container as HTMLElement);
  });
  await act(async () => {});
}

/** Land the registered fetch, as the server's response would. */
export async function resolveLoad(messages: unknown[], index = 0): Promise<void> {
  const gate = gates[index];
  if (!gate) throw new Error('no session fetch was registered');
  await act(async () => {
    gate.resolve({ session: { id: 'sess-1', messages }, hasMore: false, oldestIndex: 0 });
  });
  for (let i = 0; i < 3; i += 1) await act(async () => {});
}

/**
 * Re-render the mounted Probe with a new session id, which is what the spawn
 * adoption (`new-…` → UUID) does when the URL flips while the child streams:
 * the session-load effect re-runs and ISSUES its history fetch at that moment,
 * mid-run. The fetch registered before this call is `gates[0]`; the one this
 * issues is `gates[1]`.
 */
export async function switchSession(sessionId: string, api: ProbeApi): Promise<void> {
  await act(async () => {
    render(h(Probe, { sessionId, api }), container as HTMLElement);
  });
  await act(async () => {});
}

/** A run this page started, with its optimistic rows already on screen. */
export async function startLiveRun(api: ProbeApi): Promise<void> {
  await act(async () => {
    api.isGeneratingRef.current = true;
    api.ownRunRef.current = true;
    api.optimisticUserIdRef.current = OPTIMISTIC_USER.id;
    api.setMessages([OPTIMISTIC_USER, AI_PLACEHOLDER]);
  });
}

export const ids = (api: ProbeApi) => api.messages.map((m) => m.id);

