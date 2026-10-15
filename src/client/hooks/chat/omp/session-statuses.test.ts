/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The sidebar/navbar live-status cluster: `session-statuses` and `status`.
 *
 * These two small modules are the only wiring between a server-tracked run
 * state and the pixels the user watches, so each case pins a way the UI could
 * silently disagree with reality:
 *
 * - `isSessionStreaming` is the EXACT `streamStatus === 'stream'` test the
 *   sidebar spinner and the timeline's generating indicator share; a second
 *   tab or a background process must still light the spinner, while a stale
 *   `finish`/`abort` badge must not.
 * - `useSessionStatusAck` must POST exactly once per (session, status) so the
 *   one-shot terminal check cannot flicker, and must never ack a live row.
 * - `useAgentStreamStatus` seeds from the last published value so a navbar
 *   mounted mid-run paints the current transport instead of waiting.
 *
 * The sidebar's own poll and throttle used to be pinned here; both are gone,
 * replaced by the realtime socket's `sidebar:status` topic (see
 * `session-list.test.ts`, which drives them through a real server).
 *
 * Rendered with `h()` against happy-dom, the way the other hook tests do.
 */

import { afterAll, afterEach, beforeAll, describe, expect, jest, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import {
  buildSidebarSessionStatus,
  isChatRunning,
  isSessionStreaming,
  useSessionStatusAck,
} from '@/client/hooks/chat/omp/session-statuses';
import { useAgentStreamStatus, type AgentStreamStatus } from '@/client/hooks/chat/omp/status';
import { realtimeClient, resetRealtimeClient } from '@/shared/lib/realtime/client';
import { installDomGlobals, pristineWebSocket, restoreDomGlobals } from '@/test-support/pristine-globals';
import { startRealtimeTestServer } from '@/test-support/realtime-server';
import type { TopicResolver } from '@/server/lib/realtime/hub.server';
import type { SessionItemData } from '@/shared/types';

/** The runner's own fetch — `installFetch` replaces it for the whole process. */
/** The runner's own fetch, reached through `Bun` so a stub leaked onto the global cannot be mistaken for it. */
const nativeFetch = Bun.fetch;

let container: HTMLElement;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});



afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  jest.useRealTimers();
  // `installFetch` replaces the global for the WHOLE process; left in place it
  // answers every later suite's requests with this file's `{deleted}` body
  // (measured: `listPlugins` read `[]`, every live-listener probe read `null`).
  globalThis.fetch = nativeFetch;
  // The status store is module state too: a suite that asserts the pristine
  // seed must not read this file's `sse` transition.
});

async function mount(vnode: Parameters<typeof render>[0]) {
  container ??= document.body.appendChild(document.createElement('div'));
  await act(async () => {
    render(vnode, container as HTMLElement);
  });
}

/** Drain the promise chain a stubbed `fetch` starts (no timers involved). */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** One sidebar row, so every fixture below agrees on the item shape. */
function session(id: number | string, streamStatus?: SessionItemData['streamStatus']): SessionItemData {
  const item: SessionItemData = { id, folder_id: 1, title: `s-${id}` };
  if (streamStatus !== undefined) item.streamStatus = streamStatus;
  return item;
}

describe('buildSidebarSessionStatus', () => {
  test('keys only sessions carrying a status, by stringified id', () => {
    const map = buildSidebarSessionStatus([
      { sessions: [session(7, 'stream'), session('abc', 'finish'), session(8)] },
    ]);
    expect(map).toEqual({ '7': 'stream', abc: 'finish' });
  });

  test('walks every folder and lets the last duplicate id win', () => {
    const map = buildSidebarSessionStatus([
      { sessions: [session(1, 'finish')] },
      { sessions: [session(1, 'abort')] },
      { sessions: undefined },
    ]);
    expect(map['1']).toBe('abort');
  });
});

describe('isSessionStreaming', () => {
  const statusMap = { a: 'stream', b: 'finish', c: 'abort', 4: 'stream' } as const;

  test('is true only for the exact `stream` status, across id shapes', () => {
    expect(isSessionStreaming(statusMap, 'a')).toBe(true);
    expect(isSessionStreaming(statusMap, 4)).toBe(true);
    expect(isSessionStreaming(statusMap, '4')).toBe(true);
    expect(isSessionStreaming(statusMap, 'b')).toBe(false);
    expect(isSessionStreaming(statusMap, 'c')).toBe(false);
  });

  test('is false for a session absent from the map', () => {
    expect(isSessionStreaming(statusMap, 'missing')).toBe(false);
    expect(isSessionStreaming({}, 'a')).toBe(false);
  });

  test('is false for a null/undefined selection (nothing is open yet)', () => {
    expect(isSessionStreaming(statusMap, null)).toBe(false);
    expect(isSessionStreaming(statusMap, undefined)).toBe(false);
  });

  test('is false when no status map has arrived', () => {
    // The provider's map is `{}` before the first snapshot; a caller outside
    // the provider gets the same shape. Neither may read as a live run.
    expect(isSessionStreaming(null, 'a')).toBe(false);
    expect(isSessionStreaming(undefined, 'a')).toBe(false);
  });
});

/**
 * The CHAT-level flag. One source is the point: the server's `stream` row, the
 * same one the sidebar spinner reads. The only other term is a run the server
 * cannot name yet (a pending `new-…` chat, no omp id until the spawn answers),
 * and the caller supplies that — never a general optimistic mark.
 */
describe('isChatRunning', () => {
  const statusMap = { a: 'stream', b: 'finish' } as const;

  test('follows the server row, with no local flag involved', () => {
    expect(isChatRunning(statusMap, 'a', false)).toBe(true);
    expect(isChatRunning(statusMap, 'b', false)).toBe(false);
    expect(isChatRunning({}, 'a', false)).toBe(false);
  });

  test('counts a run the server cannot name yet (a pending new-… chat)', () => {
    // No row can exist for a session omp has not created, so the caller's
    // pending term is the only thing that can report the spawn window.
    expect(isChatRunning({}, 'new-1750000000000', true)).toBe(true);
  });

  test('never invents a run the server has already settled', () => {
    // The pending term is for the spawn window only. With it false — which is
    // what every real session passes — a terminal row is the answer, and the
    // indicator cannot outlive the run.
    expect(isChatRunning(statusMap, 'b', false)).toBe(false);
    expect(isChatRunning({ b: 'finish' }, 'b', false)).toBe(false);
    expect(isChatRunning(null, 'a', false)).toBe(false);
  });
});

interface AckApi {
  statusMap: Record<string, 'stream' | 'finish' | 'abort'>;
  activeSessionId: string | null;
  skip?: (id: number | string) => boolean;
}

describe('useSessionStatusAck', () => {
  const calls: Array<{ url: string; method: string }> = [];
  let revalidated = 0;
  let deleted = true;

  function installFetch() {
    calls.length = 0;
    revalidated = 0;
    deleted = true;
    (globalThis as unknown as Record<string, unknown>).fetch = async (input: unknown, init?: { method?: string }) => {
      calls.push({ url: String(input), method: init?.method ?? 'GET' });
      return new Response(JSON.stringify({ deleted }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
  }

  function Probe({ api }: { api: AckApi }) {
    useSessionStatusAck(api.statusMap, api.activeSessionId, () => { revalidated += 1; }, api.skip);
    return null;
  }

  test('acks a terminal badge for the open session exactly once, then revalidates', async () => {
    installFetch();
    const api: AckApi = { statusMap: { s1: 'finish' }, activeSessionId: 's1' };
    await mount(h(Probe, { api }));
    await settle();

    expect(calls).toEqual([{ url: '/api/sessions/s1/stream-seen', method: 'POST' }]);
    expect(revalidated).toBe(1);

    // Re-render with an identical map: the effect must not re-POST.
    await act(async () => { render(h(Probe, { api }), container as HTMLElement); });
    await settle();
    expect(calls.length).toBe(1);
  });

  test('never acks a live `stream` row', async () => {
    installFetch();
    await mount(h(Probe, { api: { statusMap: { s1: 'stream' }, activeSessionId: 's1' } }));
    await settle();
    expect(calls.length).toBe(0);
  });

  test('honours skip() so a click-acked badge is not double-POSTed', async () => {
    installFetch();
    await mount(h(Probe, { api: { statusMap: { s1: 'abort' }, activeSessionId: 's1', skip: () => true } }));
    await settle();
    expect(calls.length).toBe(0);
    expect(revalidated).toBe(0);
  });

  test('does nothing with no open session', async () => {
    installFetch();
    await mount(h(Probe, { api: { statusMap: { s1: 'finish' }, activeSessionId: null } }));
    await settle();
    expect(calls.length).toBe(0);
  });
});

describe('useAgentStreamStatus', () => {
  function StatusProbe({ seen }: { seen: { current: AgentStreamStatus | null } }) {
    seen.current = useAgentStreamStatus();
    return null;
  }

  test('reports the shared channel, not a per-session transport', async () => {
    // The status now describes the ONE realtime socket, so it is driven by the
    // client itself. A real listener is what makes the transition observable:
    // the value flips when the handshake completes, which is event-loop work.
    const server = await startRealtimeTestServer(new Map<string, TopicResolver>([
      ['sidebar', async () => ({ folders: [], isMock: false })],
    ]));
    // The client builds its socket URL from `window.location`, so the DOM must
    // sit on the listener's origin — this file's `beforeAll` window is a bare
    // `http://localhost`, which would dial port 80 and never connect.
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: new Window({ url: `http://127.0.0.1:${server.port}` }),
    });
    (globalThis as unknown as Record<string, unknown>).WebSocket = pristineWebSocket;
    const seen: { current: AgentStreamStatus | null } = { current: null };
    await mount(h(StatusProbe, { seen }));
    expect(seen.current?.connected).toBe(false);

    // Subscribing is what dials; the harness waits on the client's own value.
    const stop = realtimeClient.subscribe('sidebar', () => {});
    await server.waitForTopic('sidebar', (value) => value !== null);
    await act(async () => { await settle(); });
    expect(seen.current?.connected).toBe(true);

    stop();
    server.stop();
    resetRealtimeClient();
  });
});

afterAll(() => {
  globalThis.fetch = nativeFetch;
  restoreDomGlobals();
});
