/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Recovery of a run whose terminal frames were lost with the channel.
 *
 * The reported failure, end to end: a streaming chat left in a background tab,
 * the socket torn down, the turn finished with nobody reading. The timeline
 * kept the stream's last PARTIAL segment and its generating flag never
 * released, while the server's `stream` row had already settled — so the
 * indicator stopped and the answer stayed cut off mid-sentence.
 *
 * Mounted through the REAL `useSessionLoad`, because the repair is a reload of
 * that hook's own state: asserting on the recovery hook's calls would pass
 * while the timeline kept the partial row.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import { useSessionLoad } from '@/client/hooks/chat/timeline/session-load';
import { resetConnection } from '@/shared/lib/realtime/connection';
import { setStatus } from '@/shared/lib/realtime/state';
import type { ChatMessageData } from '@/shared/types';

const originalFetch = Bun.fetch;
const PARTIAL: ChatMessageData = { id: 'omp-ai', role: 'ai', content: 'The answer stops mid-sent' };
const COMMITTED: ChatMessageData[] = [
  { id: 'omp-user', role: 'user', content: 'tolong jelaskan' },
  { id: 'omp-ai', role: 'ai', content: 'The answer, in full.' },
];

let container: HTMLElement | undefined;
/** Render-triggered waiters, so a case can await the state it asserts on. */
const messageWaiters: { match: (rows: ChatMessageData[]) => boolean; resolve: () => void }[] = [];

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
  resetConnection();
  globalThis.fetch = originalFetch;
});

interface Api {
  messages: ChatMessageData[];
  generating: boolean;
  setMessages: (next: ChatMessageData[]) => void;
  /** Arm the state a dropped run leaves behind. */
  loseRun: () => void;
  /** The recovery's own flag: set when a still-live run lost segments, which
   *  is what schedules the read at its settle. A ref, not a render value — the
   *  flag is written without a state change, and no consumer renders for it. */
  needsReloadRef: { current: boolean };
  /** Run the reconnect: open → closed → open. */
  reconnect: () => Promise<void>;
  /** Resolves on the render where the timeline holds rows matching `match`:
   *  the retry is timer-driven, so this is the signal to wait on. */
  awaitMessages: (match: (rows: ChatMessageData[]) => boolean) => Promise<void>;
}

interface ProbeProps {
  api: Api;
}

function Probe({ api }: ProbeProps) {
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
  const [generating, setGeneratingState] = useState(false);
  useEffect(() => {
    for (const waiter of [...messageWaiters]) {
      if (!waiter.match(messages)) continue;
      messageWaiters.splice(messageWaiters.indexOf(waiter), 1);
      waiter.resolve();
    }
  }, [messages]);
  const setGenerating = useCallback((v: boolean) => {
    isGeneratingRef.current = v;
    setGeneratingState(v);
  }, []);

  api.messages = messages;
  api.awaitMessages = (match) => {
    if (match(messages)) return Promise.resolve();
    const { promise, resolve } = Promise.withResolvers<void>();
    messageWaiters.push({ match, resolve });
    return promise;
  };
  api.generating = generating;
  api.setMessages = setMessages;
  api.loseRun = () => {
    isGeneratingRef.current = true;
    // The stream had announced this run — that is the state a lost run is in
    // (a dispatch whose first frame never arrived is a different case, and the
    // recovery deliberately refuses it).
    streamRunRef.current = true;
    serverRunRef.current = true;
    setGeneratingState(true);
    aiPlaceholderIdRef.current = 'omp-ai';
    setMessages([PARTIAL]);
  };
  api.reconnect = async () => {
    await act(async () => {
      setStatus('open');
      setStatus('closed');
      setStatus('connecting');
      setStatus('open');
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });
  };

  const load = useSessionLoad({
    sessionId: 'omp-1',
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
  api.needsReloadRef = load.needsReloadRef;
  return null;
}

/** Route the two reads this path makes: the transcript, and the attach probe.
 *  The transcript is EMPTY until `arm()` — a run still in flight has not
 *  committed the turn it is streaming, and arming only after the drop is what
 *  makes a reload observable (an always-populated route would let a broken
 *  path pass by having the initial load paint the same rows). */
interface StubRoutes {
  transcriptReads: number;
  arm: () => void;
  /** Answer the next N transcript reads with an EMPTY list — omp buffers its
   *  writes, so the turn that just finished is not on disk yet. */
  emptyReads: (count: number) => void;
  /** Resolves once the transcript has been read `count` times: the retry is
   *  timer-driven, so this is the signal to wait on rather than a duration. */
  readsReached: (count: number) => Promise<void>;
  /** Resolves on the FIRST transcript read, so the harness can wait for the
   *  initial load to land instead of guessing a delay. */
  firstRead: Promise<void>;
}

function stubRoutes(probeAnswer: unknown): StubRoutes {
  const seen = { transcriptReads: 0, armed: false, empty: 0 };
  const waiters: { count: number; resolve: () => void }[] = [];
  const settleWaiters = (): void => {
    for (const waiter of [...waiters]) {
      if (seen.transcriptReads < waiter.count) continue;
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve();
    }
  };
  const firstRead = Promise.withResolvers<void>();
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    if (url.includes('/api/agent/')) {
      return new Response(JSON.stringify(probeAnswer), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    seen.transcriptReads += 1;
    firstRead.resolve();
    settleWaiters();
    const empty = !seen.armed || seen.empty > 0;
    if (seen.empty > 0) seen.empty -= 1;
    return new Response(JSON.stringify({
      session: { id: 'omp-1', messages: empty ? [] : COMMITTED },
      hasMore: false,
      oldestIndex: 0,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return {
    get transcriptReads() { return seen.transcriptReads; },
    arm: () => { seen.armed = true; },
    emptyReads: (count) => { seen.empty = count; },
    readsReached: (count) => {
      if (seen.transcriptReads >= count) return Promise.resolve();
      const { promise, resolve } = Promise.withResolvers<void>();
      waiters.push({ count, resolve });
      return promise;
    },
    firstRead: firstRead.promise,
  };
}

async function mount(probeAnswer: unknown): Promise<{ api: Api; routes: StubRoutes }> {
  const routes = stubRoutes(probeAnswer);
  const api = {} as Api;
  container ??= document.body.appendChild(document.createElement('div'));
  await act(async () => {
    render(h(Probe, { api }), container as HTMLElement);
  });
  // The initial history read is a real promise chain (`json()` included), so a
  // bare microtask flush is not enough — and a load landing AFTER the test arms
  // its partial row would clear it, which is the harness racing the behaviour
  // under test. Waiting on the read itself is deterministic. It is awaited
  // OUTSIDE the render's `act`: effects flush when that callback returns, so a
  // fetch issued by one cannot settle inside it.
  await act(async () => {
    await routes.firstRead;
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
  return { api, routes };
}

describe('a run whose terminal frames were lost with the channel', () => {
  test('settles the local run and replaces the partial answer with the transcript', async () => {
    const { api, routes } = await mount({ running: false });
    await act(async () => { api.loseRun(); routes.arm(); });
    expect(api.messages).toEqual([PARTIAL]);
    expect(api.generating).toBe(true);

    await api.reconnect();

    // The rows on screen were the stream's last PARTIAL segment; the session
    // JSONL is the only record of the rest.
    expect(api.messages).toEqual(COMMITTED);
    expect(api.generating).toBe(false);
  });

  test('leaves a run the server still reports as live alone — but remembers it', async () => {
    // Reloading mid-turn would replace the stream's own rows with a lagging
    // snapshot, so nothing is applied here. What must NOT be lost is the fact
    // that segments finished during the outage: their `message_end` went into
    // the dead socket, and only a full read once the run is over recovers them.
    const { api, routes } = await mount({ running: true, state: { isStreaming: true, isPromptRunning: true } });
    await act(async () => { api.loseRun(); routes.arm(); });

    await api.reconnect();

    expect(api.messages).toEqual([PARTIAL]);
    expect(api.generating).toBe(true);
    expect(api.needsReloadRef.current).toBe(true);
  });

  test('a first dial is not a reconnect and does not settle the run', async () => {
    const { api, routes } = await mount({ running: false });
    await act(async () => { api.loseRun(); routes.arm(); });

    await act(async () => {
      setStatus('connecting');
      setStatus('open');
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });

    expect(api.messages).toEqual([PARTIAL]);
    expect(api.generating).toBe(true);
  });

  test('a transcript omp has not flushed yet is retried until the turn lands', async () => {
    // omp buffers its transcript writes: the turn that just finished can be
    // absent from the file for a beat after the channel returns. One read and
    // stop would leave the partial answer on screen — the state this recovery
    // exists to clear — so an EMPTY answer is retried on the same front-loaded
    // schedule the metadata refresh uses, and stops at the first real one.
    //
    // Fake timers, not a sleep: the retry is a real `setTimeout` chain, and the
    // schedule is what this case is about.
    const { api, routes } = await mount({ running: false });
    await act(async () => {
      api.loseRun();
      routes.arm();
      routes.emptyReads(2);
    });

    await api.reconnect();
    // The first read came back empty, so the rows are still the partial answer.
    expect(api.messages).toEqual([PARTIAL]);

    // The retry is a real timer chain; wait on the RENDER that carries the
    // committed rows, not on a guessed delay. Two empty answers, so the third
    // read is the one with the turn in it.
    // The retry is a real timer chain, and the rows land from a render it
    // triggers. Awaited OUTSIDE `act`: preact defers effects until the act
    // callback returns, so waiting for a render-driven signal inside one
    // deadlocks.
    await api.awaitMessages((rows) => rows.length === COMMITTED.length);

    expect(api.messages).toEqual(COMMITTED);
    expect(routes.transcriptReads).toBeGreaterThanOrEqual(4);

    expect(api.messages).toEqual(COMMITTED);
    expect(routes.transcriptReads).toBeGreaterThanOrEqual(3);
  });

  test('a lost run on a session this server does not own still settles', async () => {
    // `running:false` is also the answer for a session owned by another
    // instance; the frames are gone either way and the transcript is readable.
    const { api, routes } = await mount({ running: false });
    await act(async () => { api.loseRun(); routes.arm(); });

    await api.reconnect();

    expect(api.generating).toBe(false);
    expect(api.messages).toEqual(COMMITTED);
  });
});
