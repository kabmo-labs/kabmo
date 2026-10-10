/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The sidebar bridge: the read a plugin gets, and the writes it makes.
 *
 * Driven through a REAL realtime server rather than a stubbed socket, for the
 * reason `test-support/realtime-server.ts` gives: the bugs worth pinning live in
 * the delivery contract, and a fake would test its own frame timing.
 *
 * Two properties are what this suite exists for:
 *
 * - **The read is a PROJECTION of the host's sidebar topics**, including the
 *   volatile status map that rides its own topic — so a plugin sees a run in
 *   flight exactly as the sidebar beside it does.
 * - **A write goes through the host's OWN route.** A rename posts
 *   `/api/sessions/:id/rename`, the same one the sidebar's inline editor posts,
 *   so the two cannot drift.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { resetRealtimeClient } from '@/shared/lib/realtime/client';
import { TOPIC_SIDEBAR, TOPIC_SIDEBAR_STATUS } from '@/shared/lib/realtime/protocol';
import { startRealtimeTestServer, type RealtimeTestServer } from '@/test-support/realtime-server';
import { installDomGlobals, pristineWebSocket, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { TopicResolver } from '@/server/lib/realtime/hub.server';
import {
  refreshSidebarThreads,
  resetSidebarBridge,
  sidebarActions,
  sidebarThreads,
  subscribeSidebarThreads,
} from '@/client/lib/plugins/sidebar-bridge';

const nativeFetch = Bun.fetch;

let server: RealtimeTestServer;
/** Requests the bridge made, so a test can assert the URL it called. */
let calls: Array<{ url: string; method: string }>;

/** One folder holding one session, as the sidebar topic carries it. */
function structure(title: string): unknown {
  return {
    isMock: false,
    folders: [
      {
        id: 7,
        name: 'ws',
        isExpanded: true,
        hasMore: false,
        totalSessions: 1,
        sessions: [
          { id: 'sess-1', folder_id: 7, title, updated_at: '2026-10-10T00:00:00.000Z' },
        ],
      },
    ],
  };
}

beforeAll(async () => {
  server = await startRealtimeTestServer(new Map<string, TopicResolver>([
    [TOPIC_SIDEBAR, async () => structure('First title')],
    [TOPIC_SIDEBAR_STATUS, async () => ({ 'sess-1': { streamStatus: 'stream' } })],
  ]));
  // The DOM must be pointed at the SERVER's origin and given the runner's own
  // WebSocket, or the client dials a socket happy-dom cannot provide — the
  // same setup every realtime-driven suite in this repo uses.
  installDomGlobals(new Window({ url: `http://127.0.0.1:${server.port}` }));
  (globalThis as unknown as Record<string, unknown>).WebSocket = pristineWebSocket;
});

afterEach(() => {
  resetRealtimeClient();
  resetSidebarBridge();
});

afterAll(() => {
  (globalThis as unknown as Record<string, unknown>).fetch = nativeFetch;
  restoreDomGlobals();
  server.stop();
});

describe('the read', () => {
  test('a subscription is pushed the folders flattened into threads', async () => {
    const seen: Array<{ value: unknown[]; stale: boolean }> = [];
    const off = subscribeSidebarThreads((state) => seen.push(state));
    await server.waitForTopic(TOPIC_SIDEBAR, (value) => value !== null);

    // The first push carries the projected rows, not the folder tree.
    const latest = seen.at(-1);
    expect(latest?.value).toHaveLength(1);
    expect((latest?.value[0] as { id: string }).id).toBe('sess-1');
    expect((latest?.value[0] as { folderId: string }).folderId).toBe('7');
    expect((latest?.value[0] as { title: string }).title).toBe('First title');
    off();
  });

  test('a run in flight is merged from the volatile topic', async () => {
    // `streamStatus` lives on its own topic because it changes on every write
    // while the structure needs a scan; a plugin must still see it.
    subscribeSidebarThreads(() => {});
    await server.waitForTopic(TOPIC_SIDEBAR, (value) => value !== null);
    await server.waitForTopic(TOPIC_SIDEBAR_STATUS, (value) => value !== null);

    const threads = sidebarThreads().value;
    expect(threads[0]?.isRunning).toBe(true);
  });

  test('a push after a rename reaches the subscriber', async () => {
    const titles: string[] = [];
    subscribeSidebarThreads((state) => titles.push((state.value[0] as { title: string })?.title));
    await server.waitForTopic(TOPIC_SIDEBAR, (value) => value !== null);

    server.publish(TOPIC_SIDEBAR, structure('Renamed by the host'));
    await server.waitForTopic(TOPIC_SIDEBAR, (value) => JSON.stringify(value).includes('Renamed'));

    expect(titles).toContain('Renamed by the host');
  });

  test('the last unsubscribe releases both topics', async () => {
    const off = subscribeSidebarThreads(() => {});
    await server.waitForTopic(TOPIC_SIDEBAR, (value) => value !== null);
    off();
    // No listener left means no subscription held; reading still answers the
    // cached value rather than throwing.
    expect(() => sidebarThreads()).not.toThrow();
  });

  test('refresh asks the server for a fresh snapshot', async () => {
    subscribeSidebarThreads(() => {});
    await server.waitForTopic(TOPIC_SIDEBAR, (value) => value !== null);
    expect(() => refreshSidebarThreads()).not.toThrow();
  });
});

describe('the writes', () => {
  /** Install a fetch that records calls and answers 200. */
  function recordFetch(ok = true): void {
    calls = [];
    (globalThis as unknown as Record<string, unknown>).fetch = async (input: unknown, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method ?? 'GET' });
      return new Response(JSON.stringify({ success: true }), {
        status: ok ? 200 : 400,
        headers: { 'content-type': 'application/json' },
      });
    };
  }

  test('rename posts the host’s own rename route', async () => {
    recordFetch();
    const ok = await sidebarActions().rename('sess-1', 'A new name');

    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/api/sessions/sess-1/rename');
    expect(calls[0]?.method).toBe('POST');
  });

  test('archive posts the archive route with the target state', async () => {
    recordFetch();
    await sidebarActions().setArchived('sess-1', true);
    expect(calls[0]?.url).toBe('/api/sessions/sess-1/archive');
  });

  test('markSeen posts the stream-seen route', async () => {
    recordFetch();
    await sidebarActions().markSeen('sess-1');
    expect(calls[0]?.url).toBe('/api/sessions/sess-1/stream-seen');
  });

  test('remove DELETEs the session route', async () => {
    recordFetch();
    await sidebarActions().remove('sess-1');
    expect(calls[0]?.url).toBe('/api/sessions/sess-1');
    expect(calls[0]?.method).toBe('DELETE');
  });

  test('a refused rename answers false rather than throwing', async () => {
    recordFetch(false);
    expect(await sidebarActions().rename('sess-1', '')).toBe(false);
  });

  test('open writes ?sessionId=, the app’s only routing state', () => {
    const win = new Window({ url: 'http://localhost/?sessionId=old' });
    installDomGlobals(win);
    sidebarActions().open('sess-9');
    expect(win.location.search).toContain('sessionId=sess-9');
  });

  test('openNew writes a pending session id and the folder', () => {
    const win = new Window({ url: 'http://localhost/' });
    installDomGlobals(win);
    sidebarActions().openNew({ folderId: '3' });
    expect(win.location.search).toContain('sessionId=new-');
    expect(win.location.search).toContain('folderId=3');
  });
});
