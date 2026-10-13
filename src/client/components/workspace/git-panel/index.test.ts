/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Source Control panel's change list comes from the REALTIME topic, not the
 * mount-time HTTP read.
 *
 * `fetched ?? git.data` did the opposite: the HTTP copy won unconditionally, so
 * a tool call that republished `git:` updated `git.data` while the panel kept
 * rendering the list it read at mount. Measured on a live server, the panel said
 * "No changes found." while `git status` reported the file a tool call had just
 * created. The topic is what the server pushes on every tool call, so it must
 * win; the HTTP read is only the ahead/behind supplement.
 *
 * Driven through a REAL realtime server, with the HTTP read answering an EMPTY
 * list and the topic a populated one: only a panel that reads the topic renders
 * any change, so the assertion is the precedence itself.
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
const SESSION = 'new-git-panel';
const TOPIC = gitTopic(`${ROOT}\u0000.`);

/** The runner's own fetch, reached through `Bun` so a leaked stub cannot be mistaken for it. */
const nativeFetch = Bun.fetch;

let container: HTMLElement;
let server: RealtimeTestServer;

/** A payload the panel renders as `n` changed files. */
function statusOf(count: number, syncCount?: { ahead: number; behind: number }): unknown {
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
    ...(syncCount ? { syncCount } : {}),
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

/** Mount the panel over a server whose topic answers one change and HTTP none. */
async function mount(options: {
  topicSync?: { ahead: number; behind: number };
  httpSync?: { ahead: number; behind: number };
} = {}): Promise<void> {
  server = await startRealtimeTestServer(new Map<string, TopicResolver>([
    [TOPIC, async () => statusOf(1, options.topicSync)],
    [reposTopic(ROOT), async () => ({ repos: ['.'], reposPending: false })],
  ]));
  const win = new Window({ url: `http://127.0.0.1:${server.port}` });
  installDomGlobals(win);
  const target = globalThis as unknown as Record<string, unknown>;
  target.WebSocket = pristineWebSocket;
  target.fetch = async (input: unknown) => {
    const url = String(input);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.includes('/state')) return json({ sessionId: SESSION, state: {} });
    if (url.includes('reposOnly')) return json({ repos: ['.'], reposPending: false });
    // The panel's own HTTP read (mount + Refresh): EMPTY, deliberately.
    return json(statusOf(0, options.httpSync));
  };

  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(
      h(SessionStateProvider, {
        sessionId: SESSION,
        children: h(GitPanel, { rootPath: ROOT, enabled: true }),
      }),
      container,
    );
  });
  // Both reads must land before the assertion: with `fetched` still undefined
  // the old precedence would accidentally pass.
  await server.waitForTopic(TOPIC, (value) => value !== null);
  for (let i = 0; i < 20; i += 1) await act(async () => {});
}

describe('GitPanel change list', () => {
  test('renders the topic list, not the mount-time HTTP read', async () => {
    await mount();
    expect(container.textContent).toContain('file-0.txt');
  });

  test('a topic push updates the list', async () => {
    await mount();
    await act(async () => {
      server.publish(TOPIC, statusOf(2));
      await server.waitForTopic(TOPIC, (value) => (value as { changes?: unknown[] })?.changes?.length === 2);
    });
    for (let i = 0; i < 20; i += 1) await act(async () => {});
    expect(container.textContent).toContain('file-1.txt');
  });
});

/**
 * The badge describes the SAME read the list does.
 *
 * The count rides the topic's payload, so it cannot describe a different read
 * than the list: pinning it to the HTTP copy is the reported bug — the list
 * followed the topic while `↑ahead` stayed at its mount value. The HTTP read
 * still matters, because it is what refreshes the branch's tracking ref; the
 * topic's count is LOCAL (no network), so `loadRepo` re-resolves the topic once
 * its fetch settles and the badge then reads a count taken from refs that
 * include it.
 */
describe('GitPanel sync badge', () => {
  test('renders the topic count, not the HTTP one', async () => {
    await mount({ topicSync: { ahead: 0, behind: 2 }, httpSync: { ahead: 0, behind: 9 } });
    expect(container.textContent).toContain('↑0 ↓2');
    expect(container.textContent).not.toContain('↓9');
  });

  test('a topic push updates the badge, not just the list', async () => {
    await mount({ topicSync: { ahead: 0, behind: 0 } });
    expect(container.textContent).toContain('↑0 ↓0');

    // A commit made outside the panel: the server republishes `git:` with the
    // LOCAL count, exactly as a tool call's `workspace-dirty` does.
    await act(async () => {
      server.publish(TOPIC, statusOf(1, { ahead: 3, behind: 2 }));
      await server.waitForTopic(TOPIC, (value) => (value as { syncCount?: { ahead?: number } })?.syncCount?.ahead === 3);
    });
    for (let i = 0; i < 20; i += 1) await act(async () => {});
    expect(container.textContent).toContain('↑3 ↓2');
  });

  test('the HTTP count fills the window before the topic snapshot lands', async () => {
    // The topic's resolver is slow (a cold `git rev-list`), so the badge has
    // only the HTTP read to go on. It must show that rather than a bare
    // `↑0 ↓0` that reads as "up to date".
    let releaseTopic: () => void = () => {};
    const topicGate = new Promise<void>((resolve) => { releaseTopic = resolve; });
    server = await startRealtimeTestServer(new Map<string, TopicResolver>([
      [TOPIC, async () => { await topicGate; return statusOf(1, { ahead: 0, behind: 3 }); }],
      [reposTopic(ROOT), async () => ({ repos: ['.'], reposPending: false })],
    ]));
    const win = new Window({ url: `http://127.0.0.1:${server.port}` });
    installDomGlobals(win);
    const target = globalThis as unknown as Record<string, unknown>;
    target.WebSocket = pristineWebSocket;
    target.fetch = async (input: unknown) => {
      const url = String(input);
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url.includes('/state')) return json({ sessionId: SESSION, state: {} });
      if (url.includes('reposOnly')) return json({ repos: ['.'], reposPending: false });
      return json(statusOf(0, { ahead: 0, behind: 5 }));
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      render(h(SessionStateProvider, { sessionId: SESSION, children: h(GitPanel, { rootPath: ROOT, enabled: true }) }), container);
    });
    for (let i = 0; i < 20; i += 1) await act(async () => {});
    expect(container.textContent).toContain('↑0 ↓5');

    // Once the topic answers, its own (newer, local) count takes over.
    releaseTopic();
    await act(async () => {
      await server.waitForTopic(TOPIC, (value) => value !== null);
    });
    for (let i = 0; i < 20; i += 1) await act(async () => {});
    expect(container.textContent).toContain('↑0 ↓3');
  });
});

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
 */
describe('GitPanel commit modal', () => {
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
