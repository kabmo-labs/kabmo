/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The committed-history fetch vs a run this page started.
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

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
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
const OPTIMISTIC_USER: ChatMessageData = { id: 'msg-1-user', role: 'user', content: 'halo', date: 'Today, 12:22 PM' };
/** The empty assistant row the stream fills. */
const AI_PLACEHOLDER: ChatMessageData = { id: 'msg-2-ai', role: 'ai', content: '' };
/** The same turn as the transcript records it, under its own id. */
const ECHOED_TURN: ChatMessageData = { id: 'omp-echo', role: 'user', content: 'halo' };

interface LoadGate {
  url: string;
  resolve: (body: unknown) => void;
}

const gates: LoadGate[] = [];

/** One mount's observable state: what the timeline holds and what drives it. */
interface ProbeApi {
  messages: ChatMessageData[];
  setMessages: (next: ChatMessageData[]) => void;
  isGeneratingRef: { current: boolean };
  ownRunRef: { current: boolean };
  aiPlaceholderIdRef: { current: string | null };
  optimisticUserIdRef: { current: string | null };
  generatingCalls: boolean[];
}

function makeApi(): ProbeApi {
  return {
    messages: [],
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

  useSessionLoad({
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
function stubChatFetch(): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const { promise, resolve } = Promise.withResolvers<Response>();
    gates.push({ url, resolve: (body) => resolve(new Response(JSON.stringify(body))) });
    return promise;
  }) as typeof fetch;
}

/** Mount the real hook and let its session-load effect register its fetch. */
async function mount(sessionId: string, api: ProbeApi): Promise<void> {
  container ??= document.body.appendChild(document.createElement('div'));
  await act(async () => {
    render(h(Probe, { sessionId, api }), container as HTMLElement);
  });
  await act(async () => {});
}

/** Land the registered fetch, as the server's response would. */
async function resolveLoad(messages: unknown[], index = 0): Promise<void> {
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
async function switchSession(sessionId: string, api: ProbeApi): Promise<void> {
  await act(async () => {
    render(h(Probe, { sessionId, api }), container as HTMLElement);
  });
  await act(async () => {});
}

/** A run this page started, with its optimistic rows already on screen. */
async function startLiveRun(api: ProbeApi): Promise<void> {
  await act(async () => {
    api.isGeneratingRef.current = true;
    api.ownRunRef.current = true;
    api.optimisticUserIdRef.current = OPTIMISTIC_USER.id;
    api.setMessages([OPTIMISTIC_USER, AI_PLACEHOLDER]);
  });
}

const ids = (api: ProbeApi) => api.messages.map((m) => m.id);

describe('a committed fetch while a run this page started is live', () => {
  test('keeps the live timeline when the payload carries the turn under its own id', async () => {
    stubChatFetch();
    const api = makeApi();
    await mount('sess-1', api);
    await startLiveRun(api);
    // The stream has already finalized the assistant's first segment, so the
    // placeholder mark is gone while the RUN continues — the exact state the
    // guard used to read as "the live timeline is done".
    api.aiPlaceholderIdRef.current = null;

    await resolveLoad([ECHOED_TURN]);

    // Not merged: the file's copy of the turn would sit beside the bubble it
    // belongs to (different ids), rendering the same prompt twice.
    expect(ids(api)).toEqual([OPTIMISTIC_USER.id, AI_PLACEHOLDER.id]);
  });

  test('never empties the timeline when the payload has no messages yet', async () => {
    stubChatFetch();
    const api = makeApi();
    await mount('sess-1', api);
    await startLiveRun(api);
    api.aiPlaceholderIdRef.current = null;

    await resolveLoad([]);

    // The fresh spawn's transcript is not readable yet; emptying here is the
    // "my first message disappeared" report.
    expect(ids(api)).toEqual([OPTIMISTIC_USER.id, AI_PLACEHOLDER.id]);
  });

  test('leaves the run\'s generating flag alone', async () => {
    stubChatFetch();
    const api = makeApi();
    await mount('sess-1', api);
    await startLiveRun(api);
    // The mount's own session-switch reset is the only call so far.
    const before = api.generatingCalls.length;

    await resolveLoad([ECHOED_TURN]);

    expect(api.generatingCalls.length).toBe(before);
    expect(api.isGeneratingRef.current).toBe(true);
  });

  test('survives a fetch issued mid-run whose run ENDED before it landed', async () => {
    // The CI failure this pins, measured on a real run: the spawn adoption
    // re-ran the load effect and issued `/api/chat/:id` while the child was
    // streaming (ownership true), `agent_end` landed ~1 ms before the response,
    // and the payload carried `messages: []` because omp had not flushed its
    // JSONL yet. Reading the guard at RESOLVE alone saw no run, took the
    // "genuinely gone" branch, and emptied the timeline — the answer that had
    // just streamed vanished. Ownership is about the rows the payload would
    // replace, so the answer from when it was ASKED still holds.
    stubChatFetch();
    const api = makeApi();
    await mount('new-1', api);
    // The send: optimistic rows mounted, run owned by this page.
    await act(async () => {
      api.isGeneratingRef.current = true;
      api.ownRunRef.current = true;
      api.optimisticUserIdRef.current = OPTIMISTIC_USER.id;
      api.setMessages([OPTIMISTIC_USER, AI_PLACEHOLDER]);
    });
    // Spawn adoption: the URL flips to the real id, so the effect re-runs and
    // issues the history fetch NOW, while the run is still live.
    await switchSession('sess-1', api);
    expect(gates.length).toBe(2);

    // The run ends before the response arrives (the ordering in the trace).
    await act(async () => {
      api.isGeneratingRef.current = false;
      api.ownRunRef.current = false;
    });

    // The lagging snapshot: omp has not written the transcript yet.
    await resolveLoad([], 1);

    expect(ids(api)).toEqual([OPTIMISTIC_USER.id, AI_PLACEHOLDER.id]);
  });
});

describe('a committed fetch with no local run', () => {
  test('lands the transcript, which is the reload-mid-run and open-a-session path', async () => {
    stubChatFetch();
    const api = makeApi();
    await mount('sess-1', api);

    await resolveLoad([ECHOED_TURN]);

    expect(ids(api)).toEqual([ECHOED_TURN.id]);
  });

  test('lands the transcript when the mount probe adopted a live run', async () => {
    // Opening (or reloading) a session ANOTHER writer is streaming: the probe
    // resumes the generating UI, so `isGeneratingRef` is true while this page
    // owns nothing. The transcript must still load — measured on a real
    // 333-message run, discarding it left 0 rows and only a "Load earlier
    // messages" button, whose click paged a window into an empty head.
    stubChatFetch();
    const api = makeApi();
    await mount('sess-1', api);
    await act(async () => { api.isGeneratingRef.current = true; });

    await resolveLoad([ECHOED_TURN]);

    expect(ids(api)).toEqual([ECHOED_TURN.id]);
  });

  test('empties a session whose transcript is genuinely gone', async () => {
    stubChatFetch();
    const api = makeApi();
    await mount('sess-1', api);
    await act(async () => { api.setMessages([OPTIMISTIC_USER, AI_PLACEHOLDER]); });

    await resolveLoad([]);

    expect(api.messages).toEqual([]);
  });

  test('a pending "new-…" session is never emptied, whatever the payload says', async () => {
    stubChatFetch();
    const api = makeApi();
    await mount('new-1', api);
    const before = api.generatingCalls.length;

    await resolveLoad([]);

    expect(ids(api)).toEqual([]);
    expect(api.generatingCalls.length).toBe(before);
  });
});
