/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The commit modal opens because the user ASKED for it — never because the
 * panel re-rendered.
 *
 * `actionFetcher.data` is sticky (it holds the last response for the life of
 * the mount) while the effect that turns a history payload into the modal also
 * depends on `loadRepo`, whose identity changes whenever `rootPath` does. So
 * switching to a session in another workspace re-ran that effect against the
 * PREVIOUS history payload and reopened a modal the user had already dismissed
 * (reported as "clicking a session item opens the commit modal").
 *
 * Split from `index.test.ts` when both files reached the repo's line ceiling;
 * each owns its own harness.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { GitPanel } from '@/client/components/workspace/git-panel';
import { SessionStateProvider } from '@/client/components/common/session-state-provider/index';
import { resetRealtimeClient } from '@/shared/lib/realtime/client';
import { gitTopic, reposTopic } from '@/shared/lib/realtime/protocol';
import { startRealtimeTestServer, type RealtimeTestServer } from '@/test-support/realtime-server';
import { installDomGlobals, pristineWebSocket, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { TopicResolver } from '@/server/lib/realtime/hub.server';

const ROOT = '/ws';
const SESSION = 'new-git-panel-modal';
const TOPIC = gitTopic(`${ROOT}\u0000.`);

/** The runner's own fetch, reached through `Bun` so a leaked stub cannot be mistaken for it. */
const nativeFetch = Bun.fetch;

let container: HTMLElement;
let server: RealtimeTestServer;

/** A payload the panel renders as `count` changed files — a repository. */
function statusOf(count: number): unknown {
  return {
    changes: Array.from({ length: count }, (_, i) => ({
      status: '??',
      file: `file-${i}.txt`,
      staged: false,
      additions: 1,
      deletions: 0,
    })),
    branch: 'main',
    branches: ['main'],
    remoteBranches: [],
    isRepo: true,
  };
}

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
  }
  resetRealtimeClient();
  server?.stop();
});

afterAll(() => {
  (globalThis as unknown as Record<string, unknown>).fetch = nativeFetch;
  restoreDomGlobals();
});

/**
 * happy-dom ships none of the three globals the modal's measurement layer
 * needs (`useLayoutEffect`'s rAF, its own `ResizeObserver`, the paging
 * `IntersectionObserver`). Stubbed rather than asserted on: the modal's
 * geometry is not what this test is about.
 */
const OBSERVER_STUBS = ['ResizeObserver', 'IntersectionObserver'] as const;
const stubs: Partial<Record<(typeof OBSERVER_STUBS)[number], unknown>> = {};

beforeAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of OBSERVER_STUBS) stubs[key] = target[key];
  target.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  target.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  // No-op rather than a timer: the geometry pass is not what this asserts, and
  // a real delay would make the case's duration depend on the machine.
  target.requestAnimationFrame = () => 0;
  target.cancelAnimationFrame = () => {};
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of OBSERVER_STUBS) {
    if (stubs[key] === undefined) delete target[key];
    else target[key] = stubs[key];
  }
  delete target.requestAnimationFrame;
  delete target.cancelAnimationFrame;
});

/** Mount with an HTTP POST that answers a history page. */
async function mountHistory(): Promise<{ rerender: (props: { rootPath: string; enabled: boolean }) => Promise<void> }> {
  server = await startRealtimeTestServer(new Map<string, TopicResolver>([
    [TOPIC, async () => statusOf(1)],
    [reposTopic(ROOT), async () => ({ repos: ['.'], reposPending: false })],
  ]));
  const win = new Window({ url: `http://127.0.0.1:${server.port}` });
  installDomGlobals(win);
  const target = globalThis as unknown as Record<string, unknown>;
  target.WebSocket = pristineWebSocket;
  target.fetch = async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.includes('/state')) return json({ sessionId: SESSION, state: {} });
    if (url.includes('reposOnly')) return json({ repos: ['.'], reposPending: false });
    if (init?.method === 'POST') {
      return json({ success: true, type: 'history', data: [{ hash: 'abc1234', message: 'first', author: 'a', time: 'now' }], hasMore: false, total: 1 });
    }
    return json(statusOf(0));
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  const rerender = async (props: { rootPath: string; enabled: boolean }) => {
    await act(async () => {
      render(h(SessionStateProvider, { sessionId: SESSION, children: h(GitPanel, props) }), container);
    });
    for (let i = 0; i < 20; i += 1) await act(async () => {});
  };
  await rerender({ rootPath: ROOT, enabled: true });
  await server.waitForTopic(TOPIC, (value) => value !== null);
  for (let i = 0; i < 20; i += 1) await act(async () => {});
  return { rerender };
}

const settle = async (rounds = 20) => { for (let i = 0; i < rounds; i += 1) await act(async () => {}); };

describe('GitPanel commit modal', () => {
  test('a dismissed modal stays dismissed when the workspace root moves', async () => {
    const { rerender } = await mountHistory();

    const historyButton = container.querySelector('button[title="Commit History"]') as HTMLButtonElement | null;
    expect(historyButton).toBeTruthy();
    await act(async () => { historyButton?.click(); });
    await settle();
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();

    const close = container.querySelector('button[title="Close modal"]') as HTMLButtonElement | null;
    expect(close).toBeTruthy();
    await act(async () => { close?.click(); });
    await settle(5);
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    await rerender({ rootPath: '/ws-other', enabled: true });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  /**
   * The same guard covers the ACTIVITY-BAR case: `enabled` is what the layout
   * flips when another right-panel view is selected, and `loadRepo` depends on
   * it too — so a panel-button click re-ran the effect exactly as a workspace
   * switch did. Reported as the modal appearing "when clicking a panel button".
   */
  test('a dismissed modal stays dismissed when the panel is toggled off and on', async () => {
    const { rerender } = await mountHistory();

    const historyButton = container.querySelector('button[title="Commit History"]') as HTMLButtonElement | null;
    expect(historyButton).toBeTruthy();
    await act(async () => { historyButton?.click(); });
    await settle();
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();

    const close = container.querySelector('button[title="Close modal"]') as HTMLButtonElement | null;
    expect(close).toBeTruthy();
    await act(async () => { close?.click(); });
    await settle(5);
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    // Selecting another view in the activity bar: the layout sets `enabled` false.
    await rerender({ rootPath: ROOT, enabled: false });
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    // And back to Source Control.
    await rerender({ rootPath: ROOT, enabled: true });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
