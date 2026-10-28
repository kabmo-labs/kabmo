/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `useRealtimeTopic`'s `refreshing` indicator.
 *
 * Every frame — the initial snapshot as much as a later push — lights the
 * indicator for a beat, so a toolbar button can spin for a value the server
 * moved on its own (a tool call republishes most topics). Driven through a REAL
 * realtime server, and the assertion is the TRANSITION (a topic that is not
 * subscribed reports no refresh; one whose frame lands reports a refresh), so no
 * timer is waited on: the pulse turning OFF is deliberately not asserted.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useRealtimeTopic } from '@/client/hooks/ui/realtime';
import { resetRealtimeClient } from '@/shared/lib/realtime/client';
import { startRealtimeTestServer, type RealtimeTestServer } from '@/test-support/realtime-server';
import { installDomGlobals, pristineWebSocket, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { TopicResolver } from '@/server/lib/realtime/hub.server';

const TOPIC = 'test:refreshing';

let container: HTMLElement;
let server: RealtimeTestServer;

function Harness({ topic }: { topic: string | null }) {
  const state = useRealtimeTopic<{ n: number }>(topic);
  return h('span', { id: 'refreshing' }, state.refreshing ? 'yes' : 'no');
}

const indicator = () => container.querySelector('#refreshing')?.textContent;

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await act(async () => {});
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
  restoreDomGlobals();
});

describe('useRealtimeTopic refreshing', () => {
  test('no subscription reports no refresh; a landed frame reports one', async () => {
    const resolver: TopicResolver = async () => ({ n: 1 });
    server = await startRealtimeTestServer(new Map<string, TopicResolver>([[TOPIC, resolver]]));
    installDomGlobals(new Window({ url: `http://127.0.0.1:${server.port}` }));
    (globalThis as unknown as Record<string, unknown>).WebSocket = pristineWebSocket;

    container = document.createElement('div');
    document.body.appendChild(container);

    // Not subscribed: nothing has moved, so the indicator is dark.
    await act(async () => {
      render(h(Harness, { topic: null }), container);
    });
    expect(indicator()).toBe('no');

    // Subscribing delivers the snapshot, which is a frame like any other.
    await act(async () => {
      render(h(Harness, { topic: TOPIC }), container);
    });
    await server.waitForTopic(TOPIC, (value) => value !== null);
    await flush();
    expect(indicator()).toBe('yes');
  });
});
