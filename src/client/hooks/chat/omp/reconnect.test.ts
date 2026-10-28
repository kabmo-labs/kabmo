/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The lost-run trigger: a channel that comes back after frames were missed.
 *
 * The reported failure is a run whose `message_end`/`agent_end` were emitted
 * into a socket nobody was reading (a backgrounded tab, a frozen phone), so the
 * timeline kept the stream's last partial segment and its generating flag never
 * released. What decides whether this hook acts is the CHANNEL, and the two
 * conditions are pinned here because getting either wrong is destructive:
 *
 * - a dial is not a reconnect. A send whose `connect()` opens a closed channel
 *   passes through `connecting`/`open` too, and settling there would delete the
 *   optimistic turn of a prompt that is not even on the wire yet.
 * - the server's verdict must be asked, and only `runIsOver` settles. An
 *   unanswered probe, a `busy` session and a live run all leave the timeline
 *   alone.
 *
 * The status publisher driven here is the one the connection layer calls
 * (`setStatus`), so the trigger path is the real one; the socket itself is not
 * what these cases are about.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { useRef } from 'preact/hooks';
import { act } from 'preact/test-utils';

import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import { useReconnectSettle } from '@/client/hooks/chat/omp/reconnect';
import { resetConnection } from '@/shared/lib/realtime/connection';
import { setStatus } from '@/shared/lib/realtime/state';

let container: HTMLElement | undefined;
const originalFetch = Bun.fetch;

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

interface Harness {
  settles: () => number;
  losses: () => number;
  /** Re-render under another session id (a spawn adoption). */
  adopt: (nextId: string) => Promise<void>;
  generating: { current: boolean };
  streamRun: { current: boolean };
  serverRun: { current: boolean };
  /** Drive the connection status the way the socket lifecycle does. */
  setStatus: (status: 'idle' | 'connecting' | 'open' | 'closed') => Promise<void>;
}

/** Answer the attach probe with `answer` (or fail when it is null). */
function stubProbe(answer: unknown, onCall?: () => void): void {
  globalThis.fetch = (async () => {
    onCall?.();
    if (answer === null) throw new Error('offline');
    return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}

async function mount(generating: boolean, sessionId = 'omp-1'): Promise<Harness> {
  const seen = {
    settles: 0,
    losses: 0,
    generating: { current: generating },
    streamRun: { current: generating },
    serverRun: { current: generating },
  };
  function Probe({ id = sessionId }: { id?: string }) {
    const generatingRef = useRef(seen.generating.current);
    // The stream has announced the run, which is the state a lost run is in.
    const streamRunRef = useRef(seen.streamRun.current);
    const serverRunRef = useRef(seen.serverRun.current);
    seen.generating = generatingRef;
    seen.streamRun = streamRunRef;
    seen.serverRun = serverRunRef;
    useReconnectSettle({
      sessionId: id,
      isGeneratingRef: generatingRef,
      streamRunRef,
      serverRunRef,
      onSettled: () => { seen.settles += 1; },
      onFramesLost: () => { seen.losses += 1; },
    });
    return null;
  }
  container ??= document.body.appendChild(document.createElement('div'));
  await act(async () => { render(h(Probe, null), container as HTMLElement); });
  return {
    settles: () => seen.settles,
    losses: () => seen.losses,
    generating: seen.generating,
    streamRun: seen.streamRun,
    serverRun: seen.serverRun,
    /** Re-render with another session id — the spawn adoption that re-mounts
     *  the effect mid-run. */
    adopt: async (nextId: string) => {
      await act(async () => {
        render(h(Probe, { id: nextId }), container as HTMLElement);
      });
    },
    setStatus: async (status) => {
      await act(async () => {
        setStatus(status);
        // Let the probe's fetch/then chain (and the re-check at the answer) run.
        for (let i = 0; i < 8; i += 1) await Promise.resolve();
      });
    },
  };
}

describe('a channel that comes back after frames were missed', () => {
  test('settles the run the server reports as finished', async () => {
    let probes = 0;
    stubProbe({ running: true, state: { isStreaming: false, isPromptRunning: false, isSettled: true } }, () => { probes += 1; });
    const harness = await mount(true);

    await harness.setStatus('open');
    await harness.setStatus('closed');
    await harness.setStatus('connecting');
    await harness.setStatus('open');

    expect(probes).toBe(1);
    expect(harness.settles()).toBe(1);
  });

  test('a session the server no longer runs is settled too', async () => {
    stubProbe({ running: false });
    const harness = await mount(true);

    await harness.setStatus('open');
    await harness.setStatus('closed');
    await harness.setStatus('open');

    expect(harness.settles()).toBe(1);
  });

  test('a run still in flight is left alone', async () => {
    stubProbe({ running: true, state: { isStreaming: true, isPromptRunning: true } });
    const harness = await mount(true);

    await harness.setStatus('open');
    await harness.setStatus('closed');
    await harness.setStatus('open');

    expect(harness.settles()).toBe(0);
  });

  test('a busy session with no run is left alone', async () => {
    // A live subagent whose parent turn ended: `busy` is not run evidence, and
    // settling it would abandon the work still going.
    stubProbe({ running: true, busy: true, state: { isStreaming: false, isPromptRunning: false } });
    const harness = await mount(true);

    await harness.setStatus('open');
    await harness.setStatus('closed');
    await harness.setStatus('open');

    expect(harness.settles()).toBe(0);
  });

  test('an unanswered probe settles nothing', async () => {
    stubProbe(null);
    const harness = await mount(true);

    await harness.setStatus('open');
    await harness.setStatus('closed');
    await harness.setStatus('open');

    expect(harness.settles()).toBe(0);
  });

  test('a FIRST dial is not a reconnect', async () => {
    // The send path opens a closed channel for a prompt it is about to send:
    // no frames can have been missed, so the optimistic turn must survive.
    stubProbe({ running: true, state: { isStreaming: false, isPromptRunning: false, isSettled: true } });
    const harness = await mount(true);

    await harness.setStatus('connecting');
    await harness.setStatus('open');

    expect(harness.settles()).toBe(0);
  });

  test('a session with NO run at all is never probed', async () => {
    // Nothing has started, so nothing can have been lost: a reconnect on an
    // idle session must not even ask.
    let probes = 0;
    stubProbe({ running: false }, () => { probes += 1; });
    const harness = await mount(false);

    await harness.setStatus('open');
    await harness.setStatus('closed');
    await harness.setStatus('open');

    expect(probes).toBe(0);
    expect(harness.settles()).toBe(0);
  });

  test('a run that FLICKERED off before the drop still counts as lost', async () => {
    // Measured on a real run: the drop landed in a beat where the generating
    // flag and both run flags read false (the spawn-adoption window, a
    // `prompt_result` folded as settled), so the loss was read as "nothing was
    // running" — and the transcript was never re-read. The evidence is
    // LATCHED, so a flicker cannot erase it.
    let probes = 0;
    stubProbe({ running: false }, () => { probes += 1; });
    const harness = await mount(true);

    await harness.setStatus('open');
    // Every live signal goes quiet before the channel does.
    harness.generating.current = false;
    harness.streamRun.current = false;
    harness.serverRun.current = false;
    await harness.setStatus('closed');
    await harness.setStatus('open');

    expect(probes).toBe(1);
    expect(harness.settles()).toBe(1);
  });

  test('the loss is recorded at the DROP, before any probe answers', async () => {
    // The probe is a request, and a run can settle while it is in flight —
    // measured as a flaky e2e where `agent_end` arrived first, read a flag that
    // was still false, and never re-read the transcript. What was lost is a
    // fact about the drop, so it is written then.
    let probes = 0;
    stubProbe({ running: true, state: { isStreaming: true } }, () => { probes += 1; });
    const harness = await mount(true);

    await harness.setStatus('open');
    await harness.setStatus('closed');

    // No `open` yet: the probe has not even been issued.
    expect(probes).toBe(0);
    expect(harness.losses()).toBe(1);
    expect(harness.settles()).toBe(0);
  });

  test('a spawn adoption DURING the outage does not lose the fact', async () => {
    // The effect is keyed on the session id, and that id moves mid-run: a spawn
    // answers with omp's UUID a beat after the first prompt. A tab that went
    // away in that window re-mounted the effect INSIDE the outage, and local
    // variables came back with `wasOpen:false` — so the drop read as a dial
    // that never opened, nothing was recorded, and the transcript was never
    // re-read (measured on a real run; the e2e spec caught it as a flake).
    let probes = 0;
    stubProbe({ running: true, state: { isStreaming: true } }, () => { probes += 1; });
    const harness = await mount(true, 'new-1');

    await harness.setStatus('open');
    await harness.setStatus('closed');
    // The adoption lands while the channel is down.
    await harness.adopt('omp-1');
    await harness.setStatus('connecting');
    await harness.setStatus('open');

    expect(harness.losses()).toBe(1);
    expect(probes).toBe(1);
  });

  test('a probe that answers "still live" settles nothing', async () => {
    stubProbe({ running: true, state: { isStreaming: true } });
    const harness = await mount(true);

    await harness.setStatus('open');
    await harness.setStatus('closed');
    await harness.setStatus('open');

    expect(harness.settles()).toBe(0);
    expect(harness.losses()).toBe(1);
  });

  test('the SERVER\'s stream row alone is enough evidence', async () => {
    // A run whose very FIRST frame (`agent_start`) was the one lost has no
    // stream-side mark on this client, but the server wrote its `stream` row at
    // dispatch — and that row is what proves frames could have been missed.
    // Without this the first-frame loss was unrecoverable: the timeline kept
    // the empty placeholder while the answer streamed into a socket that was
    // gone.
    stubProbe({ running: false });
    const harness = await mount(true);
    harness.streamRun.current = false;
    harness.serverRun.current = true;

    await harness.setStatus('open');
    await harness.setStatus('closed');
    await harness.setStatus('open');

    expect(harness.settles()).toBe(1);
  });

  test('a drop with no run believed live settles nothing', async () => {
    stubProbe({ running: true, state: { isStreaming: false, isSettled: true } });
    const harness = await mount(false);

    await harness.setStatus('open');
    await harness.setStatus('closed');
    await harness.setStatus('open');

    expect(harness.settles()).toBe(0);
  });

  test('a run that finished during the drop is settled once, not on every reconnect', async () => {
    stubProbe({ running: false });
    const harness = await mount(true);

    await harness.setStatus('open');
    await harness.setStatus('closed');
    await harness.setStatus('open');
    expect(harness.settles()).toBe(1);

    // The settle path releases the generating flag; a second flap must not
    // re-settle (and must not re-read the transcript again).
    harness.generating.current = false;
    await harness.setStatus('closed');
    await harness.setStatus('open');
    expect(harness.settles()).toBe(1);
  });
});
