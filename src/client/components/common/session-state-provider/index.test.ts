/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A pending (`new-…`) session's UI-state slot is persisted like any other, so
 * the provider must LOAD it like any other.
 *
 * The id is what the URL carries (`?sessionId=new-…`), so a reload of a pending
 * chat re-enters the slot with a row already on the server. The provider used to
 * treat `new-…` as "nothing stored yet" and mark it ready without a fetch, which
 * showed every fallback there (the repo picker reset to the workspace root) and
 * then let the next write destroy the stored blob — the persist body is the
 * WHOLE in-memory map, so a state that was never loaded persisted as one key.
 *
 * Rendered with `h()` (no JSX) against happy-dom. No timers are waited on: the
 * load chain is promise hops only, and the write path is driven through the
 * store's own `flushSession` instead of the 600 ms persist debounce.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { SessionStateProvider } from '@/client/components/common/session-state-provider/index';
import { useSessionState } from '@/client/hooks/workspace/session-state';
import { flushSession } from '@/shared/lib/workspace/session-state/store';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent'] as const;
/** The runner's own globals, restored on teardown — deleting them would strip natives (Event/CustomEvent) every later file needs. */const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
/** The runner's own fetch — this file replaces it for the whole process. */
/** The runner's own fetch, reached through `Bun` so a stub leaked onto the global cannot be mistaken for it. */
const nativeFetch = Bun.fetch;

let container: HTMLElement;
const calls: { url: string; method: string; body: { state?: Record<string, unknown> } | null }[] = [];
let stored: Record<string, unknown> = {};

/** Reads the repo slot and can write the layout slot — the way the panels do. */
function Probe() {
  const [repo] = useSessionState<unknown>('git.activeRepo', null);
  const [panel, setPanel] = useSessionState<string>('layout.activeRightPanel', 'files');
  return h('div', null, h('span', null, JSON.stringify(repo)), h('span', null, panel), h('button', { onClick: () => setPanel('git') }, 'open-git'));
}

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  target.fetch = async (input: unknown, init?: { method?: string; body?: unknown }) => {
    const method = init?.method ?? 'GET';
    calls.push({ url: String(input), method, body: init?.body ? JSON.parse(String(init.body)) : null });
    return new Response(JSON.stringify(method === 'POST' ? { success: true } : { sessionId: 'x', state: stored }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
  // The runner's own fetch comes back: `delete` removed the global outright,
  // so every suite after this one had no `fetch` at all.
  target.fetch = nativeFetch;
});

afterEach(() => {
  calls.length = 0;
  stored = {};
});

/** Mounts the provider on a pending id and drains the load's promise chain. */
async function mountPending(sessionId: string) {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(SessionStateProvider, { sessionId, children: h(Probe, null) }), container);
  });
  for (let i = 0; i < 20; i += 1) await act(async () => {});
  return container;
}

/** Re-render the same mount on another session id, the way a click does. */
async function switchTo(el: HTMLElement, sessionId: string): Promise<void> {
  await act(async () => {
    render(h(SessionStateProvider, { sessionId, children: h(Probe, null) }), el);
  });
  for (let i = 0; i < 20; i += 1) await act(async () => {});
}

describe('SessionStateProvider on a pending session', () => {
  test('restores the stored blob a reloaded pending chat already has', async () => {
    stored = { 'git.activeRepo': { root: '/ws', repo: 'projects/a' }, 'layout.activeRightPanel': 'git' };

    const el = await mountPending('new-test-restore');

    expect(calls.some((c) => c.url === '/api/sessions/new-test-restore/state' && c.method === 'GET')).toBe(true);
    expect(el.textContent).toContain('projects/a');
    expect(el.textContent).toContain('git');
  });

  test('a write after the restore persists the stored keys too', async () => {
    stored = { 'git.activeRepo': { root: '/ws', repo: 'projects/a' } };
    const sessionId = 'new-test-keep';

    const el = await mountPending(sessionId);
    (el.querySelector('button') as HTMLButtonElement).click();
    await act(async () => {
      await flushSession(sessionId);
    });

    const post = calls.find((c) => c.method === 'POST');
    expect(post?.url).toBe(`/api/sessions/${sessionId}/state`);
    expect(post?.body?.state).toMatchObject({
      'git.activeRepo': { root: '/ws', repo: 'projects/a' },
      'layout.activeRightPanel': 'git',
    });
  });

  test('a plain switch away from a pending chat is NOT an adoption', async () => {
    // Only a spawn may carry the transient slot's UI state onto another id.
    // Every move away from a pending chat looks the same from the URL, so the
    // ungated version copied the pending chat's draft into whatever session the
    // user clicked next and persisted it there — measured as a POST for that
    // session carrying `chat.draft`.
    const el = await mountPending('new-test-switch');
    await switchTo(el, 'real-9');

    // The other session is LOADED, never migrated onto: no write for it is
    // issued by the transition itself, and the stored blob it owns is read.
    expect(calls.some((c) => c.url === '/api/sessions/real-9/state' && c.method === 'GET')).toBe(true);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });
});
