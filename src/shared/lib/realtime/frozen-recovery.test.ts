/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The reported Android failure, end to end against a REAL server.
 *
 * A backgrounded phone freezes the page: the server's 30s protocol heartbeat
 * reaps the socket because a frozen tab cannot answer a ping, and the browser
 * never learns — `readyState` still says OPEN and no `close` is delivered. The
 * channel used to sit on that corpse until the user reloaded the page.
 *
 * What this suite adds over the unit ones: the client is driven through its
 * PUBLIC surface against a real `WebSocket` and the real route, so the wiring is
 * production's; and the repair is triggered by nothing but time — no
 * `visibilitychange`, no `pageshow`, no `online`, no native shell hook.
 * `watchdog.test.ts` pins the decision table and `connection.test.ts` the
 * interval that drives it; this pins that the decision reaches a live socket,
 * abandons it, re-dials and RESUBSCRIBES.
 *
 * The real-time dependency is deliberate and named: the watchdog ticks on the
 * platform clock, and faking that clock would fake the thing under test. Nothing
 * here waits for a duration — the assertion is a topic value that can only
 * arrive through the new socket's subscription.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import { realtimeClient } from '@/shared/lib/realtime/client';
import { state } from '@/shared/lib/realtime/state';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import { startRealtimeTestServer, type RealtimeTestServer } from '@/test-support/realtime-server';

let server: RealtimeTestServer | undefined;

afterEach(() => {
  server?.stop();
  server = undefined;
  restoreDomGlobals();
});

describe('a frozen page with a socket the server already reaped', () => {
  test('the watchdog re-dials and resubscribes with no event and no reload', async () => {
    let value = 1;
    server = await startRealtimeTestServer(new Map([['probe:topic', async () => value]]));
    // The dial path builds its URL from `window.location` and uses its timers, so
    // the window has to exist — and it has to name the listener's own port, or
    // the socket dials a port nothing serves. `installDomGlobals` also swaps in
    // the runner's own `WebSocket`, which is what makes the socket REAL.
    installDomGlobals(new Window({ url: `http://127.0.0.1:${server.port}` }));

    const unsubscribe = realtimeClient.subscribe('probe:topic', () => {});
    try {
      await server.waitForTopic<number>('probe:topic', (current) => current !== null, 5_000);
      expect(realtimeClient.status()).toBe('open');
      const reaped = state().socket!;

      // The freeze, written as the state a frozen page leaves behind rather than
      // by advancing a clock: an open-looking socket, silence older than the idle
      // window, and a connection the server no longer answers on. `send` throwing
      // is what a reaped socket does — the probe cannot be delivered, which is how
      // the client discovers it is dead.
      state().lastInboundAt = Date.now() - 60_000;
      reaped.send = () => {
        throw new Error('socket was reaped while the page was frozen');
      };

      // The NEW value can only reach this client through the replacement socket's
      // subscription: the server answers every subscribe with a fresh snapshot,
      // and nothing is buffered for a dead one. So this one assertion covers the
      // whole chain — the probe failing, the socket being abandoned, the re-dial,
      // and the live topic set being resubscribed.
      value = 42;
      const recovered = await server.waitForTopic<number>('probe:topic', (current) => current === 42, 25_000);
      expect(recovered).toBe(42);
      expect(realtimeClient.status()).toBe('open');
      expect(state().socket).not.toBe(reaped);
    } finally {
      unsubscribe();
    }
  }, 40_000);
});
