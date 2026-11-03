/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The client half of "close this tab".
 *
 * The rules live on the server (`tab-close.ts`, `routes/browser/tabs.ts`); what
 * this hook must get right is the request it sends, the tab it names for the
 * panel next, and — the failure that actually bites — that a refused close is
 * REPORTED rather than looking like a tab that merely came back.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { useCloseBrowserTab } from '@/client/hooks/browser/use-close-tab';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event'] as const;
const native: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    native[key] = target[key];
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

const globals = globalThis as unknown as Record<string, unknown>;
const nativeFetch = globals.fetch;

interface Captured {
  url: string;
  method: string;
  body: unknown;
}

let captured: Captured[] = [];
let reply: { status: number; body: unknown } = { status: 200, body: { ok: true, next: 't3' } };
let hook: ReturnType<typeof useCloseBrowserTab> | null = null;

function Probe({ sessionId }: { sessionId: string }) {
  hook = useCloseBrowserTab(sessionId);
  return h('div', null, hook.closing ?? '');
}

beforeEach(() => {
  captured = [];
  reply = { status: 200, body: { ok: true, next: 't3' } };
  globals.fetch = (url: string, init: RequestInit) => {
    captured.push({ url, method: init.method ?? 'GET', body: JSON.parse(String(init.body)) });
    return Promise.resolve(new Response(JSON.stringify(reply.body), { status: reply.status }));
  };
  hook = null;
});

afterEach(() => {
  globals.fetch = nativeFetch;
});

async function mount(sessionId = 'session-1'): Promise<void> {
  const host = document.createElement('div');
  await act(async () => {
    render(h(Probe, { sessionId }), host);
  });
}

describe('useCloseBrowserTab', () => {
  test('posts the target id to the session’s own close route', async () => {
    await mount();
    const result = await hook!.closeTab('t2');
    expect(captured).toEqual([
      { url: '/api/browser/session-1/tabs/close', method: 'POST', body: { targetId: 't2' } },
    ]);
    expect(result).toEqual({ ok: true, next: 't3' });
  });

  test('returns null when no tab is left to select', async () => {
    reply = { status: 200, body: { ok: true, next: null } };
    await mount();
    expect(await hook!.closeTab('only')).toEqual({ ok: true, next: null });
  });

  test('a refusal is reported with the server’s own wording', async () => {
    reply = { status: 403, body: { error: 'That tab does not belong to this session' } };
    await mount();
    expect(await hook!.closeTab('other')).toEqual({
      ok: false,
      next: null,
      error: 'That tab does not belong to this session',
    });
  });

  test('a refusal with no message still names the status', async () => {
    reply = { status: 503, body: {} };
    await mount();
    expect((await hook!.closeTab('t1')).error).toBe('Close failed (503)');
  });

  test('a network failure does not look like a closed tab', async () => {
    globals.fetch = () => Promise.reject(new Error('offline'));
    await mount();
    const result = await hook!.closeTab('t1');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('offline');
  });

  test('a closed tab id is percent-encoded into the URL', async () => {
    await mount('a/b');
    await hook!.closeTab('t1');
    expect(captured[0].url).toBe('/api/browser/a%2Fb/tabs/close');
  });

  test('an empty target is refused without a request', async () => {
    await mount();
    expect(await hook!.closeTab('')).toEqual({ ok: false, next: null, error: 'No tab to close' });
    expect(captured).toEqual([]);
  });

  test('a close already in flight leaves its tab marked, then clears', async () => {
    const { promise, resolve } = Promise.withResolvers<Response>();
    globals.fetch = () => promise;
    await mount();
    let pending: Promise<unknown> | null = null;
    await act(async () => {
      pending = hook!.closeTab('t2');
    });
    expect(hook!.closing).toBe('t2');
    await act(async () => {
      resolve(new Response(JSON.stringify({ ok: true, next: null }), { status: 200 }));
      await pending;
    });
    expect(hook!.closing).toBeNull();
  });
});
