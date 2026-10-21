/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The follow-up queue's client view and the rewind request, both against a
 * stubbed `fetch`.
 *
 * The queue is server-owned: the panel must POST the item WITHOUT its local id
 * (the id is the server's), paint the item optimistically under a `queue-…`
 * placeholder, then replace its list wholesale with the canonical queue the
 * response carries. A missing session is a no-op, not a fetch to `/null`.
 *
 * `requestRewind` is the whole point of the rewind module: the endpoint answers
 * 400 with the SERVER's reason (an entry the file does not carry, a turn that
 * is not a user message), and swallowing that into a bare `false` left the user
 * believing the timeline moved. The request body also has to carry `startedAt`
 * only when the caller has one — it is the only way to resolve a cut at a row
 * the session file does not carry.
 */

import { afterEach, beforeAll, afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import type { QueuedMessage } from '@/shared/types';
import { SessionStateContext } from '@/client/hooks/workspace/session-state/context';
import { useChatTimelineQueue, type ChatTimelineQueueResult } from '@/client/hooks/chat/timeline/queue';
import { requestRewind } from '@/client/hooks/chat/timeline/rewind';
import { restoreRealtime, silenceRealtime } from '@/test-support/silent-socket';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'CustomEvent'] as const;
/** The runner's own globals, restored on teardown so later files still have them. */
const native: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

/** The runner's own fetch, reached through `Bun` so a stub leaked onto the global cannot be mistaken for it. */
const originalFetch = Bun.fetch;
const calls: Array<{ url: string; method: string; body: string | null }> = [];
/** Canonical queue the next response carries. */
let canonical: QueuedMessage[] = [];
/** When set, the next fetch waits on this before answering. */
let gate: { promise: Promise<void>; release: () => void } | null = null;

function stubFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: init?.body === undefined ? null : String(init.body),
    });
    if (gate) await gate.promise;
    return new Response(JSON.stringify({ queue: canonical }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

let container: HTMLElement | undefined;
let latest: ChatTimelineQueueResult | null = null;

function Probe({ sessionId }: { sessionId: string | null }) {
  latest = useChatTimelineQueue(sessionId);
  return h('span', { id: 'queue' }, JSON.stringify(latest.messageQueue));
}

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
beforeEach(() => {
  // The queue hook subscribes to its session topic on mount, and this origin has
  // no listener: a real dial would fail asynchronously, after the globals are
  // restored. Per case, because `restoreRealtime` clears the constructor.
  silenceRealtime();
  calls.length = 0;
  canonical = [];
  gate = null;
  stubFetch();
});
afterEach(() => {
  restoreRealtime();
  if (container) render(null, container);
  container?.remove();
  latest = null;
  globalThis.fetch = originalFetch;
});

async function mount(sessionId: string | null) {
  container ??= document.body.appendChild(document.createElement('div'));
  await act(async () => {
    render(
      h(SessionStateContext.Provider as never, { value: { sessionId, ready: true } }, h(Probe, { sessionId })),
      container as HTMLElement,
    );
  });
  const ui = {
    flush: async () => {
      for (let i = 0; i < 5; i += 1) await act(async () => {});
    },
    text: () => (container?.querySelector('#queue') as HTMLElement).textContent ?? '',
  };
  await ui.flush();
  return ui;
}

const item = (id: string, text = 'later'): QueuedMessage => ({ id, text, attachments: [], model: null });

describe('useChatTimelineQueue', () => {
  test('hydrates from the session queue endpoint on mount', async () => {
    canonical = [item('srv-1', 'first')];
    const ui = await mount('sess-1');
    expect(calls.some((c) => c.method === 'GET' && c.url === '/api/sessions/sess-1/queue')).toBe(true);
    expect(JSON.parse(ui.text())).toEqual([item('srv-1', 'first')]);
  });

  test('enqueue POSTs the item WITHOUT the local id, then adopts the canonical queue', async () => {
    const ui = await mount('sess-1');
    canonical = [item('srv-9', 'queued text')];
    latest?.enqueueMessage({ text: 'queued text', attachments: [], model: null });
    await ui.flush();
    const post = calls.find((c) => c.method === 'POST' && c.url === '/api/sessions/sess-1/queue');
    expect(post?.body).toBe(JSON.stringify({ text: 'queued text', attachments: [], model: null }));
    expect(JSON.parse(ui.text())).toEqual([item('srv-9', 'queued text')]);
  });

  test('the optimistic row uses a queue-<epoch> placeholder id', async () => {
    const ui = await mount('sess-1');
    gate = (() => {
      let release!: () => void;
      const promise = new Promise<void>((resolve) => {
        release = resolve;
      });
      return { promise, release };
    })();
    latest?.enqueueMessage({ text: 'pending', attachments: [], model: null });
    await act(async () => {});
    const optimistic = JSON.parse(ui.text()) as QueuedMessage[];
    expect(optimistic).toHaveLength(1);
    expect(optimistic[0]?.id).toMatch(/^queue-\d+$/);
    expect(optimistic[0]?.text).toBe('pending');
    gate.release();
    gate = null;
    await ui.flush();
  });

  test('enqueue without a session is a no-op', async () => {
    const ui = await mount(null);
    calls.length = 0;
    latest?.enqueueMessage({ text: 'nowhere', attachments: [], model: null });
    await ui.flush();
    expect(calls).toEqual([]);
    expect(ui.text()).toBe('[]');
  });

  test('removeMessage drops the row locally and DELETEs it by id', async () => {
    canonical = [item('a'), item('b')];
    const ui = await mount('sess-1');
    canonical = [item('b')];
    latest?.removeMessage('a');
    await ui.flush();
    expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/sessions/sess-1/queue/a')).toBe(true);
    expect(JSON.parse(ui.text())).toEqual([item('b')]);
  });

  test('reorderMessages PUTs the ordered ids and reorders the local list', async () => {
    canonical = [item('a'), item('b'), item('c')];
    const ui = await mount('sess-1');
    canonical = [item('c'), item('a'), item('b')];
    latest?.reorderMessages(['c', 'a', 'b']);
    await ui.flush();
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.url).toBe('/api/sessions/sess-1/queue');
    expect(put?.body).toBe(JSON.stringify({ orderedIds: ['c', 'a', 'b'] }));
    expect(JSON.parse(ui.text())).toEqual([item('c'), item('a'), item('b')]);
  });

  test('switching to a null session clears the list', async () => {
    canonical = [item('a')];
    const ui = await mount('sess-1');
    expect(JSON.parse(ui.text())).toHaveLength(1);
    await act(async () => {
      render(
        h(SessionStateContext.Provider as never, { value: { sessionId: null, ready: true } }, h(Probe, { sessionId: null })),
        container as HTMLElement,
      );
    });
    await ui.flush();
    expect(ui.text()).toBe('[]');
  });
});

describe('requestRewind', () => {
  /** Rewind requests recorded by the fetch stub for these cases. */
  const rewinds: Array<{ url: string; body: unknown }> = [];

  beforeEach(() => {
    rewinds.length = 0;
  });

  function rewindFetch(options: {
    rewind?: { status: number; body?: string };
    transcript?: unknown;
    throwOnPost?: string;
  }) {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/rewind')) {
        rewinds.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
        if (options.throwOnPost) throw new Error(options.throwOnPost);
        const status = options.rewind?.status ?? 200;
        return new Response(options.rewind?.body ?? '{}', { status });
      }
      return new Response(JSON.stringify(options.transcript ?? { session: { messages: [] } }), { status: 200 });
    }) as typeof fetch;
  }

  test('posts entryId alone when the row has no startedAt', async () => {
    rewindFetch({});
    await requestRewind('sess-1', 'entry-7');
    expect(rewinds).toEqual([{ url: '/api/chat/sess-1/rewind', body: { entryId: 'entry-7' } }]);
  });

  test('includes startedAt when the caller has one', async () => {
    rewindFetch({});
    await requestRewind('sess-1', 'entry-7', 1712345678901);
    expect(rewinds[0]?.body).toEqual({ entryId: 'entry-7', startedAt: 1712345678901 });
  });

  test('URL-encodes the session id', async () => {
    rewindFetch({});
    await requestRewind('a/b c', 'e1');
    expect(rewinds[0]?.url).toBe('/api/chat/a%2Fb%20c/rewind');
  });

  test('returns the SERVER reason on a 400 instead of a bare false', async () => {
    rewindFetch({ rewind: { status: 400, body: JSON.stringify({ error: 'Entry not found in session file' }) } });
    const result = await requestRewind('sess-1', 'missing');
    expect(result).toEqual({ ok: false, error: 'Entry not found in session file' });
  });

  test('falls back to the HTTP status when the refusal body is not JSON', async () => {
    rewindFetch({ rewind: { status: 400, body: '<html>bad request</html>' } });
    const result = await requestRewind('sess-1', 'x');
    expect(result).toEqual({ ok: false, error: 'Rewind failed (HTTP 400)' });
  });

  test('reports a transport failure with its message', async () => {
    rewindFetch({ throwOnPost: 'connection refused' });
    const result = await requestRewind('sess-1', 'x');
    expect(result).toEqual({ ok: false, error: 'connection refused' });
  });

  test('on success re-reads the truncated transcript', async () => {
    rewindFetch({ transcript: { session: { messages: [{ id: 'm1', role: 'user', content: 'hi' }] } } });
    const result = await requestRewind('sess-1', 'entry-7');
    expect(result).toEqual({ ok: true, messages: [{ id: 'm1', role: 'user', content: 'hi' }] });
  });

  test('reports null messages when the re-read carries none', async () => {
    rewindFetch({ transcript: { session: {} } });
    const result = await requestRewind('sess-1', 'entry-7');
    expect(result).toEqual({ ok: true, messages: null });
  });
});
