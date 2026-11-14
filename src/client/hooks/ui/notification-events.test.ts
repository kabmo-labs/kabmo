/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `useNotificationEvents`: the page posts what the SERVER decided.
 *
 * Two contracts are pinned here, and both were bugs in the client-side version
 * this replaced. A snapshot is never news — replaying one on reconnect is what
 * announced every accumulated run at once. And a delta is delivered through the
 * shell's `notification_show` with the event's own tag and session, so a tap
 * opens the session the banner names.
 *
 * Driven through a REAL realtime server (the same harness `realtime.test.ts`
 * uses): the delivery path under test is the production one, and the wait is
 * the shell's own captured call rather than a duration.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useNotificationEvents } from '@/client/hooks/ui/notification-events';
import { resetRealtimeClient } from '@/shared/lib/realtime/client';
import { TOPIC_NOTIFICATIONS } from '@/shared/lib/realtime/protocol';
import { startRealtimeTestServer, type RealtimeTestServer } from '@/test-support/realtime-server';
import { installDomGlobals, pristineWebSocket, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { TopicResolver } from '@/server/lib/realtime/hub.server';

let container: HTMLElement;
let server: RealtimeTestServer;
let calls: Array<{ method: string; params?: Record<string, unknown> }>;
let win: Window;

function Harness() {
  useNotificationEvents();
  return h('span', {}, 'ready');
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await act(async () => {});
}

/** Resolve once the shell has been asked to show something. */
async function waitForCall(): Promise<{ method: string; params?: Record<string, unknown> }> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const shown = calls.find((call) => call.method === 'notification_show');
    if (shown) return shown;
    // A real socket, so the wait is wall-clock: the publish can only be
    // delivered once the client's dial has completed.
    await new Promise((resolve) => setTimeout(resolve, 10));
    await flush();
  }
  throw new Error('the shell was never asked to show a notification');
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
  delete (window as unknown as Record<string, unknown>).__kabmoCall;
});

afterAll(() => {
  restoreDomGlobals();
});

describe('useNotificationEvents', () => {
  test('a delta posts the banner; its snapshot does not', async () => {
    const resolver: TopicResolver = async () => ({ events: [] });
    server = await startRealtimeTestServer(new Map<string, TopicResolver>([[TOPIC_NOTIFICATIONS, resolver]]));
    win = new Window({ url: `http://127.0.0.1:${server.port}` });
    installDomGlobals(win);
    (globalThis as unknown as Record<string, unknown>).WebSocket = pristineWebSocket;

    calls = [];
    // The shell bridge the page adapts (`transport.ts` declares it on Window).
    (win as unknown as { __kabmoCall: (method: string, params?: Record<string, unknown>) => Promise<unknown> })
      .__kabmoCall = (method, params) => {
        calls.push({ method, params });
        return Promise.resolve(null);
      };

    container = document.createElement('div');
    document.body.appendChild(container);
    await act(async () => {
      render(h(Harness, {}), container);
    });
    // The subscribe's snapshot is the empty baseline: nothing worth a banner.
    // Waiting for the client's own status makes the assertion below about the
    // delta rather than about a dial that had not finished yet.
    await server.waitForTopic(TOPIC_NOTIFICATIONS, (value) => value !== null);
    await flush();
    expect(calls).toEqual([]);

    server.publish(TOPIC_NOTIFICATIONS, {
      id: 12,
      kind: 'error',
      sessionId: 's-1',
      title: 'Fix the build',
      body: 'The run ended with error',
      at: 1_763_000_000_000,
    });

    expect(await waitForCall()).toEqual({
      method: 'notification_show',
      params: {
        title: 'Fix the build',
        body: 'The run ended with error',
        tag: 'error:s-1',
        sessionId: 's-1',
        // The event's own moment travels with it: a banner delivered later must
        // not claim it just happened.
        when: '1763000000000',
      },
    });
  });
});
