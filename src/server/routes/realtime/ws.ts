/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The unified realtime socket — the one channel every server-originated event
 * travels on.
 *
 * A client subscribes to topics; the hub answers each with a snapshot and then
 * pushes deltas. The route is a thin adapter: it owns the connection's
 * subscription set and hands frames to `attachObserverStream`, which already
 * provides the coalescer, the 30s protocol keepalive and an idempotent teardown
 * (the same policy the agent and BTW sockets used).
 *
 * **Origin-checked**, like the terminal and dictation routes and unlike the
 * per-session agent/BTW sockets it replaces. A WebSocket upgrade carries the
 * page's `Origin` and no preflight protects it, so without this a cross-origin
 * page could subscribe to another session's stream. The root `authGate` also
 * runs on the upgrade (verified: Elysia applies `onBeforeHandle` to a composed
 * `.ws()` route), so an unauthenticated tab is refused before `open`.
 *
 * **Per-connection state lives on `ws.data`**, never in a `WeakMap` keyed by the
 * `ws` object: Elysia hands `pong` the raw socket and a fresh wrapper to every
 * other callback, so a WeakMap lookup always misses. See `@/server/lib/observer-ws`.
 */

import { Elysia } from 'elysia';
import { attachObserverStream, createObserverState, type ObserverConnectionState } from '@/server/lib/observer-ws';
import { isSameOriginUpgrade } from '@/server/lib/http/same-origin';
import { getRealtimeHub, type RealtimeConnection } from '@/server/lib/realtime/hub.server';
import { isKnownTopic } from '@/server/lib/realtime/topics.server';
import { decodeClientFrame } from '@/shared/lib/realtime/protocol';

type RealtimeWsData = {
  observer?: ObserverConnectionState;
  connection?: RealtimeConnection;
};

export const realtimeWsRoutes = new Elysia({ prefix: '/api/realtime' }).ws('/ws', {
  beforeHandle({ request, status }) {
    if (!isSameOriginUpgrade(request)) return status(403, 'Cross-origin realtime upgrade rejected');
  },

  open(ws) {
    const data = ws.data as unknown as RealtimeWsData;
    const state = createObserverState();
    data.observer = state;

    const { push } = attachObserverStream(state, ws);

    const connection: RealtimeConnection = {
      topics: new Set(),
      snapshotted: new Set(),
      closed: false,
      send: (frame) => push('', frame),
    };
    data.connection = connection;

    // Teardown must release the hub's subscriptions too, or a closed socket
    // keeps being handed frames it can never deliver.
    const release = state.teardown;
    state.teardown = () => {
      getRealtimeHub().release(connection);
      release();
    };
  },

  message(ws, raw) {
    const data = ws.data as unknown as RealtimeWsData;
    const connection = data.connection;
    if (!connection || connection.closed) return;

    // `raw` is a JSON frame Elysia has already parsed (see the decoder's doc),
    // so it is handed over as-is; the decoder accepts both shapes.
    const frame = decodeClientFrame(raw);
    if (!frame) return;

    const hub = getRealtimeHub();
    switch (frame.t) {
      case 'subscribe':
      case 'resync':
        for (const topic of frame.topics) {
          if (!isKnownTopic(topic)) {
            connection.send({ t: 'error', code: 'unknown_topic', message: `Unknown topic: ${topic}`, topic });
            continue;
          }
          // `resync` re-delivers the snapshot for a topic already subscribed —
          // that is the whole repair for a detected gap, so it must not be
          // treated as a no-op subscribe.
          if (frame.t === 'subscribe' && connection.topics.has(topic)) continue;
          hub.subscribe(connection, topic);
        }
        break;
      case 'unsubscribe':
        for (const topic of frame.topics) hub.unsubscribe(connection, topic);
        break;
      case 'ping':
        connection.send({ t: 'pong', id: frame.id });
        break;
    }
  },

  pong(ws) {
    const state = (ws.data as unknown as RealtimeWsData).observer;
    if (state) state.awaitingPong = false;
  },

  close(ws) {
    const data = ws.data as unknown as RealtimeWsData;
    if (data.connection) getRealtimeHub().release(data.connection);
    if (data.observer) data.observer.teardown();
  },
});
