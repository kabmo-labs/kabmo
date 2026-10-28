/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/** The `useOmpAgent` RPC-command half of `stream.test.ts`: follow-ups,
 * interrupts, model/thinking picks and dialog answers posted through the
 * bridge. Split verbatim so both files stay under the repo's 350-line
 * ceiling. */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { useRef } from 'preact/hooks';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import { act } from 'preact/test-utils';
import { useOmpAgent } from '@/client/hooks/chat/omp/index';

import type { OmpAgentCallbacks, OmpAgentEvent, OmpAgentHandle } from '@/shared/types';



let container: HTMLElement;

/** Minimal WebSocket double: records instances and lets a test drive events. */
class StubSocket {
  static latest: StubSocket[] = [];
  url: string;
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: unknown = null;

  constructor(url: string) {
    this.url = url;
    StubSocket.latest.push(this);
  }

  close() { this.closed = true; }
  open() { this.onopen?.(); }
  frame(data: OmpAgentEvent) { this.onmessage?.({ data: JSON.stringify(data) }); }
  drop() { this.onclose?.(); }
}

class StubEventSource {
  static latest: StubEventSource[] = [];
  static CLOSED = 2;
  static readonly instances: StubEventSource[] = StubEventSource.latest;
  url: string;
  readyState = 0;
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    StubEventSource.latest.push(this);
  }

  close() { this.closed = true; }
  open() { this.readyState = 1; this.onopen?.(); }
  frame(data: OmpAgentEvent) { this.onmessage?.({ data: JSON.stringify(data) }); }
}

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  // The RPC commands are exercised through stubs; the agent stream's own
  // transport is covered by `stream.test.ts` against a real socket.
  const target = globalThis as unknown as Record<string, unknown>;
  target.WebSocket = StubSocket;
  target.EventSource = StubEventSource;
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  StubSocket.latest = [];
  StubEventSource.latest = [];
});

function mount(vnode: Parameters<typeof render>[0]) {
  container ??= document.body.appendChild(document.createElement('div'));
  return act(async () => { render(vnode, container as HTMLElement); });
}



/** Mounts `useOmpAgentStream` with fresh refs and exposes its api + state. */
interface StubCall { url: string; method: string; body: Record<string, unknown>; }

function stubFetch(answers: Record<string, unknown>) {
  const calls: StubCall[] = [];
  (globalThis as unknown as Record<string, unknown>).fetch = async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : {} });
    const answer = answers[url];
    if (answer === undefined) return new Response('{}', { status: 200 });
    return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return calls;
}

/** Mounts `useOmpAgent` and exposes the handle plus the refs it owns. */
function mountAgent(sessionId: string | null, callbacks: OmpAgentCallbacks = {}) {
  const seen: { handle: OmpAgentHandle | null } = { handle: null };

  function Probe({ id }: { id: string | null }) {
    seen.handle = useOmpAgent(id, callbacks, useRef(''));
    return null;
  }

  return {
    mount: () => mount(h(Probe, { id: sessionId })),
    rerender: (id: string | null) => act(async () => { render(h(Probe, { id }), container as HTMLElement); }),
    handle: () => seen.handle as OmpAgentHandle,
  };
}

/** Flush the promise chain behind the mount-time GET probe. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}


describe('useOmpAgent RPC commands', () => {
  const SID = 'sess/1';
  const ROUTE = `/api/agent/${encodeURIComponent(SID)}`;

  test('steering posts `steer` (not abort_and_prompt) and reports the refusal', async () => {
    const calls = stubFetch({ [ROUTE]: { success: true } });
    const probe = mountAgent(SID);
    await probe.mount();
    await settle();

    expect(await probe.handle().steerOmpRun('pivot')).toEqual({ ok: true, busy: false });
    // `steer` delivers INTO the running turn. `abort_and_prompt` would cancel
    // it — measured on omp 18.8.3: steer keeps one agent_start/agent_end pair
    // for the run, abort_and_prompt produces two.
    expect(calls.at(-1)?.body).toEqual({ type: 'steer', message: 'pivot' });

    // A refusal resolves with the server's own reason instead of a bare false:
    // the composer is already cleared, so the caller has to be able to say why.
    stubFetch({ [ROUTE]: { error: 'The session is waiting on an approval dialog — answer or dismiss it first.' } });
    const refused = await probe.handle().steerOmpRun('pivot');
    expect(refused.ok).toBe(false);
    expect(refused.error).toContain('approval dialog');
    // A steer does not create a run boundary, so no interrupt guard is armed
    // and none can be left swallowing a later agent_end.
    expect(probe.handle().isGenerating).toBe(false);
  });

  test('model, thinking level and dialog answers post their RPC bodies', async () => {
    const calls = stubFetch({ [ROUTE]: { success: true } });
    const probe = mountAgent(SID);
    await probe.mount();
    await settle();

    await probe.handle().setModel('anthropic', 'claude');
    expect(calls.at(-1)?.body).toEqual({ type: 'set_model', provider: 'anthropic', modelId: 'claude' });

    await probe.handle().setThinkingLevel('high');
    expect(calls.at(-1)?.body).toEqual({ type: 'set_thinking_level', level: 'high' });

    await probe.handle().respondToExtensionUi({ id: 'ui-7' } as never, { confirmed: true });
    expect(calls.at(-1)?.body).toEqual({ type: 'extension_ui_response', id: 'ui-7', confirmed: true });
  });

  test('abort posts the stop command and drops the interrupt guard', async () => {
    const calls = stubFetch({ [ROUTE]: { success: true } });
    const probe = mountAgent(SID);
    await probe.mount();
    await settle();

    await probe.handle().abort();
    expect(calls.at(-1)?.body).toEqual({ type: 'abort' });
    expect(probe.handle().isGenerating).toBe(false);
  });
});

afterAll(() => {
  restoreDomGlobals();
});
