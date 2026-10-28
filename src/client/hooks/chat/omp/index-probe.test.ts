/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The mount probe that `useOmpAgent` runs on every session ARRIVAL.
 *
 * Its two jobs are replay and reattach, and only the second one is about a
 * session switch. The first is not: `pendingUiRequests` is how an ask/approval
 * dialog omp raised survives a page load or a session-id change, because the
 * dialog queue is reset whenever the id moves and omp never re-sends the frame.
 *
 * That distinction is the regression this pins. `useOmpAgent` skips its REF
 * bookkeeping when an arrival is the same conversation (a spawn answering with
 * its id — see `run-switch.ts`), and an early return over the whole effect took
 * the probe with it: the `ask` card then rendered its options as inert rows on
 * "Waiting for the previous answer…" while omp blocked forever. Measured in
 * `ask.e2e.ts` — `/^Yes\b/` matched no button — and confirmed by A/B: the early
 * return failed 3 of 5 repeats, the guarded version passed 25 of 25.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { useRef } from 'preact/hooks';
import { act } from 'preact/test-utils';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import { useOmpAgent } from '@/client/hooks/chat/omp/index';
import { adoptPendingSession, releasePendingSession, startPendingSession } from '@/client/hooks/chat/omp/pending-sessions';
import type { ExtensionUiDialogRequest, OmpAgentCallbacks, OmpAgentHandle } from '@/shared/types';

let container: HTMLElement | null = null;
let originalFetch: unknown;
let originalWebSocket: unknown;
let originalEventSource: unknown;

/** A socket double: the probe calls `connect` on a live run, and a real dial
 *  would leave an unhandled `error` event (measured: the suite reported
 *  `0 fail` and still exited 1). */
class StubSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: unknown = null;
  constructor(public url: string) {}
  close() {}
}

class StubEventSource extends StubSocket {
  static readonly CLOSED = 2;
  readyState = 0;
}
/** Pending ids this file minted, released after each case. */
const created: string[] = [];

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  originalFetch = Reflect.get(globalThis, 'fetch');
  originalWebSocket = Reflect.get(globalThis, 'WebSocket');
  originalEventSource = Reflect.get(globalThis, 'EventSource');
  Reflect.set(globalThis, 'WebSocket', StubSocket);
  Reflect.set(globalThis, 'EventSource', StubEventSource);
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  container = null;
  for (const id of created.splice(0)) releasePendingSession(id);
  Reflect.set(globalThis, 'fetch', originalFetch);
  Reflect.set(globalThis, 'WebSocket', originalWebSocket);
  Reflect.set(globalThis, 'EventSource', originalEventSource);
});

afterAll(() => {
  restoreDomGlobals();
});

interface ProbeCall {
  url: string;
  method: string;
}

/** Answer every request with the same body, recording what was asked. */
function stubProbe(answer: unknown): ProbeCall[] {
  const calls: ProbeCall[] = [];
  Reflect.set(globalThis, 'fetch', async (input: unknown, init?: { method?: string }) => {
    calls.push({ url: String(input), method: init?.method ?? 'GET' });
    return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return calls;
}

function mountAgent(callbacks: OmpAgentCallbacks) {
  const seen: { handle: OmpAgentHandle | null } = { handle: null };
  function Probe({ id }: { id: string | null }) {
    seen.handle = useOmpAgent(id, callbacks, useRef(''));
    return null;
  }
  container ??= document.body.appendChild(document.createElement('div'));
  return {
    render: (id: string | null) => act(async () => { render(h(Probe, { id }), container as HTMLElement); }),
    handle: () => seen.handle as OmpAgentHandle,
  };
}

/** Let the probe's fetch/then chain settle. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
}

describe('useOmpAgent session-arrival probe', () => {
  test('a SPAWN ADOPTION still replays its dialogs', async () => {
    // The arrival that skips the ref bookkeeping: `new-…` → omp's UUID, which
    // `isRunSwitch` recognises as the same conversation. The probe must survive
    // that skip — the dialog queue was just reset by the id change, and omp
    // never re-sends the frame, so a skipped replay leaves the `ask` card with
    // inert option rows and the agent blocked forever.
    const request: ExtensionUiDialogRequest = {
      type: 'extension_ui_request',
      id: 'ask-1',
      method: 'select',
      title: 'Choose a flavour',
    };
    const calls = stubProbe({ running: true, state: { isStreaming: true }, pendingUiRequests: [request] });
    const replayed: string[] = [];
    const agent = mountAgent({ onExtensionUiRequest: (incoming) => replayed.push(incoming.id) });

    const pending = startPendingSession(1);
    created.push(pending);
    await agent.render(pending);
    await settle();

    // The pending arrival probed too (its own child may exist), so the count
    // starts over: what this case is about is the ADOPTION's replay.
    replayed.length = 0;

    adoptPendingSession(pending, 'omp-9', 1);
    await agent.render('omp-9');
    await settle();

    expect(calls.some((call) => call.url.includes('/api/agent/omp-9'))).toBe(true);
    expect(replayed).toEqual(['ask-1']);
  });

  test('a re-render with the SAME id does not re-probe', async () => {
    // The effect keys on the id, so an unrelated re-render must not re-ask the
    // server on every paint.
    const calls = stubProbe({ running: false });
    const agent = mountAgent({});

    await agent.render('omp-1');
    await settle();
    const afterFirst = calls.length;
    expect(afterFirst).toBeGreaterThan(0);

    await agent.render('omp-1');
    await settle();
    expect(calls.length).toBe(afterFirst);
  });
});
