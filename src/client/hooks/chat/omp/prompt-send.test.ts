/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `useOmpPromptSender` — the two prompt-delivery paths of the live bridge.
 *
 * Both paths are a sequence of requests whose ORDER and BODY matter:
 * `sendPrompt` warms an idle session (`get_state`, the request that lazily
 * spawns the process and the only place an approval mode can be applied),
 * attaches the event stream, then POSTs the prompt. `sendNewPrompt` creates the
 * session with `ensure_session` — model/thinking/mode picks must ride THAT body
 * so omp applies them before the first prompt — then prompts through the normal
 * route. A failure at any step must leave `isGenerating` false with the server's
 * error surfaced. The sidebar is NOT signalled from here: it follows the
 * realtime `sidebar:status` topic, which the server publishes on the status
 * write the dispatch performs.
 *
 * Every case asserts the request stream (method, url, JSON body) against a
 * stubbed fetch, which is the observable contract of this hook.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

import { useOmpPromptSender } from '@/client/hooks/chat/omp/prompt-send';
import type { OmpPromptSender, OmpPromptSenderDeps } from '@/client/hooks/chat/omp/prompt-send';
import type { AgentImage, OmpAgentState } from '@/shared/types';


let container: HTMLElement;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
});

interface Request {
  url: string;
  method: string;
  body: Record<string, unknown>;
}

/** Stub fetch: records every request and answers from a url→body table. */
function installFetch(answers: Record<string, { status?: number; body?: unknown; reject?: boolean }>) {
  const requests: Request[] = [];
  (globalThis as unknown as Record<string, unknown>).fetch = async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = String(input);
    const request: Request = { url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : {} };
    requests.push(request);
    const answer = answers[url] ?? { body: { success: true } };
    if (answer.reject) throw new Error('network down');
    return new Response(JSON.stringify(answer.body ?? {}), {
      status: answer.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return requests;
}

function mountSender(sessionId: string | null) {
  const sessionIdRef = { current: sessionId };
  const connected: string[] = [];
  const deps: OmpPromptSenderDeps = {
    sessionIdRef,
    connect: (sid) => { connected.push(sid); },
    setState: (next) => {
      state = typeof next === 'function' ? next(state) : next;
    },
  };
  let state: OmpAgentState = { isGenerating: false, connected: false, error: null };
  const seen: { current: OmpPromptSender | null } = { current: null };
  function Probe() {
    seen.current = useOmpPromptSender(deps);
    return null;
  }
  container ??= document.body.appendChild(document.createElement('div'));
  render(h(Probe, null), container);
  return {
    sender: () => seen.current as OmpPromptSender,
    state: () => state,
    connected,
  };
}

const IMAGE: AgentImage = { type: 'image', data: 'AAAA', mimeType: 'image/png' };
const SID = 'sess/1';

describe('useOmpPromptSender.sendPrompt', () => {
  test('refuses with no live session, without touching the network', async () => {
    const requests = installFetch({});
    const probe = mountSender(null);
    const result = await probe.sender().sendPrompt('hi');
    expect(result.ok).toBe(false);
    expect(requests.length).toBe(0);
  });

  test('warms the session, attaches the stream, then prompts — in that order', async () => {
    const requests = installFetch({});
    const probe = mountSender(SID);

    const result = await probe.sender().sendPrompt('hello world');

    expect(result.ok).toBe(true);
    expect(requests.map((r) => [r.method, r.url])).toEqual([
      ['POST', `/api/agent/${encodeURIComponent(SID)}`],
      ['POST', `/api/agent/${encodeURIComponent(SID)}`],
    ]);
    // Warm-up: a bare get_state with no approval mode.
    expect(requests[0].body).toEqual({ type: 'get_state' });
    // Prompt: message only — no images key for an empty/absent list.
    expect(requests[1].body).toEqual({ type: 'prompt', message: 'hello world' });
    expect(probe.connected).toEqual([SID]);
    expect(probe.state()).toEqual({ isGenerating: true, connected: false, error: null });
  });

  test('carries images and the approval mode on BOTH warm-up and prompt', async () => {
    const requests = installFetch({});
    const probe = mountSender(SID);
    await probe.sender().sendPrompt('look', [IMAGE], { accessMode: 'yolo' });

    expect(requests[0].body).toEqual({ type: 'get_state', accessMode: 'yolo' });
    expect(requests[1].body).toEqual({ type: 'prompt', message: 'look', images: [IMAGE], accessMode: 'yolo' });
  });

  test('still prompts when the warm-up fails, but never attaches the stream', async () => {
    // First request (warm-up) fails, second succeeds — a keyed stub cannot
    // split them, so fail by call ordinal.
    const requests: Request[] = [];
    let call = 0;
    (globalThis as unknown as Record<string, unknown>).fetch = async (input: unknown, init?: { method?: string; body?: string }) => {
      call += 1;
      requests.push({ url: String(input), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : {} });
      if (call === 1) return new Response('{}', { status: 500 });
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    };
    const probe = mountSender(SID);
    const result = await probe.sender().sendPrompt('go');

    expect(result.ok).toBe(true);
    expect(probe.connected).toEqual([]);
    expect(requests[1].body).toEqual({ type: 'prompt', message: 'go' });
  });

  test('a refused prompt clears isGenerating and surfaces the server error', async () => {
    const requests = installFetch({});
    let call = 0;
    (globalThis as unknown as Record<string, unknown>).fetch = async (input: unknown, init?: { method?: string; body?: string }) => {
      call += 1;
      const url = String(input);
      requests.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : {} });
      if (call === 1) return new Response(JSON.stringify({ success: true }), { status: 200 });
      return new Response(JSON.stringify({ error: 'session_busy' }), { status: 200 });
    };
    const probe = mountSender(SID);
    const result = await probe.sender().sendPrompt('go');

    expect(result.ok).toBe(false);
    // A bare `session_busy` (ack timed out) may already have been accepted, so
    // it is NOT the typed refusal: the caller must not auto-requeue it.
    expect(result.busy).toBe(false);
    expect(probe.state().isGenerating).toBe(false);
    expect(probe.state().error).toBe('session_busy');
  });

  test('a transport failure is reported, not thrown', async () => {
    installFetch({ [`/api/agent/${encodeURIComponent(SID)}`]: { reject: true } });
    const probe = mountSender(SID);
    const result = await probe.sender().sendPrompt('go');

    expect(result.ok).toBe(false);
    expect(result.busy).toBe(false);
    expect(probe.state().error).toBe('network down');
  });

  test("omp's typed mid-turn refusal is reported as `busy` so the caller can queue it", async () => {
    // The server maps omp's `AgentBusyError` ("Agent is already processing …")
    // to `{ code: 'agent_busy' }`. Nothing was delivered, so the caller must be
    // able to tell this apart from every other failure and re-send the message
    // through the queue rather than lose it — the bug this pins.
    let call = 0;
    (globalThis as unknown as Record<string, unknown>).fetch = async () => {
      call += 1;
      if (call === 1) return new Response(JSON.stringify({ success: true }), { status: 200 });
      return new Response(
        JSON.stringify({ error: 'The agent is still working on the previous turn; the message was not sent.', code: 'agent_busy' }),
        { status: 400 },
      );
    };
    const probe = mountSender(SID);
    const result = await probe.sender().sendPrompt('go');

    expect(result.ok).toBe(false);
    expect(result.busy).toBe(true);
  });
});

describe('useOmpPromptSender.sendNewPrompt', () => {
  const NEW = '/api/agent/new';

  test('creates the session with the composer picks, then prompts it', async () => {
    const requests = installFetch({
      [NEW]: { body: { success: true, sessionId: 'omp-9', model: { provider: 'anthropic', modelId: 'claude' } } },
    });
    const probe = mountSender(null);

    const result = await probe.sender().sendNewPrompt('first', '/work/tree', [IMAGE], {
      model: { provider: 'anthropic', modelId: 'claude' },
      thinkingLevel: 'high',
      accessMode: 'always-ask',
      modes: { plan: true, goal: false },
    });

    expect(result).toEqual({ sessionId: 'omp-9', model: { provider: 'anthropic', modelId: 'claude' } });
    expect(requests[0].url).toBe(NEW);
    expect(requests[0].body).toEqual({
      type: 'ensure_session',
      cwd: '/work/tree',
      provider: 'anthropic',
      modelId: 'claude',
      thinkingLevel: 'high',
      accessMode: 'always-ask',
      modes: { plan: true, goal: false },
    });
    // The prompt goes through the ordinary session route, images included.
    expect(requests[1].url).toBe('/api/agent/omp-9');
    expect(requests[1].body).toEqual({ type: 'prompt', message: 'first', images: [IMAGE] });
    expect(probe.connected).toEqual(['omp-9']);
  });

  test('omits every unset pick so a bare spawn behaves as before', async () => {
    const requests = installFetch({ [NEW]: { body: { success: true, sessionId: 'omp-1' } } });
    const probe = mountSender(null);
    const result = await probe.sender().sendNewPrompt('first', '/w');

    expect(requests[0].body).toEqual({ type: 'ensure_session', cwd: '/w' });
    expect(requests[1].body).toEqual({ type: 'prompt', message: 'first' });
    expect(result).toEqual({ sessionId: 'omp-1', model: null });
  });

  test('a create failure returns null without connecting or prompting', async () => {
    const requests = installFetch({ [NEW]: { status: 500, body: { error: 'no workspace' } } });
    const probe = mountSender(null);
    const result = await probe.sender().sendNewPrompt('first', '/w');

    expect(result).toBeNull();
    expect(requests.length).toBe(1);
    expect(probe.connected).toEqual([]);
    expect(probe.state().error).toBe('no workspace');
  });

  test('a prompt failure returns null even though the session was created', async () => {
    const requests = installFetch({ [NEW]: { body: { success: true, sessionId: 'omp-3' } } });
    let call = 0;
    (globalThis as unknown as Record<string, unknown>).fetch = async (input: unknown, init?: { method?: string; body?: string }) => {
      call += 1;
      const url = String(input);
      requests.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : {} });
      if (call === 1) return new Response(JSON.stringify({ success: true, sessionId: 'omp-3' }), { status: 200 });
      return new Response(JSON.stringify({ error: 'boom' }), { status: 500 });
    };
    const probe = mountSender(null);
    const result = await probe.sender().sendNewPrompt('first', '/w');

    expect(result).toBeNull();
    expect(probe.connected).toEqual(['omp-3']);
    expect(probe.state().isGenerating).toBe(false);
  });
});

afterAll(() => {
  restoreDomGlobals();
});
