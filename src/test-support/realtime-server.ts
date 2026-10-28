/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Test seam for the unified realtime channel.
 *
 * The hub is server-authoritative and its whole job is producing frames, so a
 * test of a panel's realtime behaviour needs a SERVER, not a stubbed socket:
 * stubbing `WebSocket` would test the fake's frame timing rather than the
 * delivery contract. This starts a real Elysia listener serving the real route
 * over real topic resolvers, and the code under test dials it through the real
 * client — the same approach `agent/ws.test.ts` takes, and for the same reason:
 * the bugs worth pinning live in the framework's callback identity and the
 * hub's ordering, which a fake cannot reproduce.
 *
 * Waiting is done on the CLIENT's own notifications (`waitForTopic`), never on
 * a duration and never on a second observer socket: an observer socket would
 * prove the server sent a frame, not that the code under test processed it.
 *
 * One harness per test FILE: the hub, its topics and the listener are process
 * state, so a file that installs a different topic set owns the harness for its
 * whole run.
 */

import { Elysia } from 'elysia';
import { getRealtimeHub, registerTopics, resetRealtimeHub, type TopicDescriptor, type TopicResolver } from '@/server/lib/realtime/hub.server';
import { realtimeClient, resetRealtimeClient } from '@/shared/lib/realtime/client';
import { pristineWebSocket } from '@/test-support/pristine-globals';
import { realtimeWsRoutes } from '@/server/routes/realtime/ws';

export interface RealtimeTestServer {
  /** The listener's port, for building the socket URL. */
  port: number;
  /** Publish a topic's new value to every subscriber, as a producer would. */
  publish: (topic: string, payload: unknown) => void;
  /**
   * Wait until the CLIENT's value for `topic` satisfies `match`.
   *
   * The wait is the client's own notification, so it resolves exactly when the
   * code under test has the value — not when the server sent it, and not after
   * a guessed delay. The observer subscription is removed before resolving so
   * it cannot keep a topic alive past the assertion.
   */
  waitForTopic: <T>(topic: string, match: (value: T | null) => boolean, timeoutMs?: number) => Promise<T>;
  stop: () => void;
}

/** Build the descriptor map `startRealtimeTestServer` takes from plain resolvers. */
export function testDescriptors(resolvers: Map<string, TopicResolver>): Map<string, TopicDescriptor> {
  return new Map([...resolvers].map(([topic, resolve]) => [topic, { resolve }]));
}

/**
 * Block until the listener accepts an upgrade, retrying while it settles.
 *
 * A bound listener is not yet an accepting one: measured, the FIRST upgrade a
 * process makes can hang in CONNECTING with no `open`, `error` or `close` at
 * all. That is the worst failure shape for this channel, because the client's
 * reconnect backoff is driven by `close` — with no close, the socket waits
 * forever and the test times out instead of reporting a connection problem.
 */
async function waitForUpgrade(port: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const opened = await new Promise<boolean>((resolve) => {
      const probe = new pristineWebSocket(`ws://127.0.0.1:${port}/api/realtime/ws`);
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        try {
          probe.close();
        } catch {
          // Already gone.
        }
        resolve(value);
      };
      probe.onopen = () => finish(true);
      probe.onerror = () => finish(false);
      probe.onclose = () => finish(false);
      setTimeout(() => finish(false), 300);
    });
    if (opened) return;
  }
}

/**
 * Start a listener serving the realtime route over the given topic resolvers.
 *
 * ASYNC because the listener must be proven to accept before the caller dials:
 * measured, the FIRST dial in a process can hang with no `open`, `error` or
 * `close` at all — the socket sits in CONNECTING against a listener that has
 * bound but is not yet accepting. A readiness probe removes the race, and a
 * hung dial is the worst failure shape here because the client's backoff never
 * fires (there is no `close` to trigger it).
 */
export async function startRealtimeTestServer(resolvers: Map<string, TopicResolver>): Promise<RealtimeTestServer> {
  resetRealtimeHub();
  // The client is process state too, and a suite that ran earlier may have left
  // it holding a socket to a listener that is gone: the next `subscribe` would
  // then find a socket already present and never dial this server, leaving the
  // channel stuck on the previous one's dead connection.
  resetRealtimeClient();
  registerTopics(testDescriptors(resolvers));
  // The client dials through this, not through the global: the test process
  // shares `WebSocket` with every other suite, and one that stubs it would
  // otherwise leave this client dialing a stub that never opens.
  realtimeClient.setSocketConstructor(pristineWebSocket);

  const app = new Elysia().use(realtimeWsRoutes);
  const server = app.listen(0);
  // `server.server` is Bun's listener, typed loosely by the adapter. Narrow on
  // the one field this needs rather than asserting a shape.
  const listener = server.server;
  if (!listener || typeof listener.port !== 'number') throw new Error('realtime test listener has no port');
  const port = listener.port;

  // Prove the listener ACCEPTS an upgrade before handing the port to the code
  // under test. An HTTP answer is not enough: measured, the first upgrade in a
  // process can hang in CONNECTING against a bound-but-not-yet-accepting
  // listener, and a hung dial is the worst failure here because the client's
  // backoff never fires (there is no `close` to trigger it).
  await waitForUpgrade(port);

  return {
    port,
    publish: (topic, payload) => getRealtimeHub().publish(topic, payload),
    waitForTopic: <T>(topic: string, match: (value: T | null) => boolean, timeoutMs = 2_000) => {
      const current = realtimeClient.read<T>(topic);
      if (match(current)) return Promise.resolve(current as T);
      return new Promise<T>((resolve, reject) => {
        let unsubscribe = () => {};
        const timer = setTimeout(() => {
          unsubscribe();
          reject(new Error(`timed out waiting for topic ${topic}`));
        }, timeoutMs);
        unsubscribe = realtimeClient.subscribe(topic, () => {
          const value = realtimeClient.read<T>(topic);
          if (!match(value)) return;
          clearTimeout(timer);
          unsubscribe();
          resolve(value as T);
        });
      });
    },
    stop: () => {
      server.stop();
      realtimeClient.setSocketConstructor(null);
      resetRealtimeHub();
    },
  };
}
