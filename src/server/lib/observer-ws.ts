/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Shared lifecycle for Kabmo's observer WebSocket streams (agent events,
 * BTW frames). Both routes hand-rolled the same connection state — an
 * unsubscribe slot, a ping/pong keepalive, a latest-wins coalescer, and a
 * teardown that releases all three — so the policy lives here once, exactly as
 * `createSseStream` and `createEventCoalescer` own the SSE side.
 *
 * **Per-connection state must live on `ws.data`, never in a `WeakMap` keyed by
 * the `ws` object.** Elysia's Bun adapter constructs a NEW `ElysiaWS` wrapper
 * for every callback and hands `pong` the RAW `ServerWebSocket` rather than a
 * wrapper at all (verified on 1.4.30: `open` receives `ElysiaWS`, `pong`
 * receives the raw socket, and a `WeakMap` lookup in either misses). A missed
 * `pong` lookup never clears `awaitingPong`, so the second heartbeat tears down
 * a socket the client is still reading — every observer stream died at 60s
 * (measured: a fresh Kabmo instance closed a healthy socket at 60.005ms with
 * `STREAM_HEARTBEAT_MS` = 30s). A missed `close` lookup leaks the interval, the
 * coalescer and the session subscription for the process's lifetime.
 *
 * `ws.data` is one object shared by every callback, so it is the only stable
 * key. The routes keep their own store object in it and pass it here.
 */

import { createEventCoalescer, type EventCoalescer } from '@/server/lib/sse';
import { STREAM_HEARTBEAT_MS } from '@/shared/lib/workspace/refresh-cadence';

/** Coalesce replaceable frames once this many bytes sit unsent. */
const HIGH_WATER_BYTES = 256 * 1024;

/** Longest a coalesced frame may wait before it is flushed anyway, so a burst
 *  that ends while the socket is still busy never strands the newest frame. */
const FLUSH_DELAY_MS = 50;

/** The Bun server socket, narrowed to the two members this module reads. */
interface ObserverRawSocket {
  bufferedAmount?: number;
  ping?: () => void;
}

/** The Elysia `ws` context, narrowed to the members this module uses. */
export interface ObserverSocket {
  raw: unknown;
  send: (data: string) => unknown;
  close: () => void;
}

/** State a route keeps on `ws.data`; `closed` is also read by its own guards. */
export interface ObserverConnectionState {
  closed: boolean;
  unsubscribe: (() => void) | null;
  heartbeat: ReturnType<typeof setInterval> | null;
  awaitingPong: boolean;
  coalescer: EventCoalescer | null;
  /** Idempotent release, installed by `attachObserverStream`. The route's
   *  `close` handler calls it; before attach it is a no-op. */
  teardown: () => void;
}

/** A fresh state object for `ws.data`. */
export function createObserverState(): ObserverConnectionState {
  return {
    closed: false,
    unsubscribe: null,
    heartbeat: null,
    awaitingPong: false,
    coalescer: null,
    teardown: () => {},
  };
}

/** What an attached connection exposes back to its route. */
export interface ObserverStream {
  /** Emit one frame through the coalescer (latest-wins while backpressured). */
  push: (event: string, data: unknown) => void;
}

/**
 * Attach the coalescer + keepalive to one accepted connection. Teardown is
 * installed on `state` (the route's `close` handler calls it) and is idempotent
 * from any path: a heartbeat, a send failure, or the route's own exit.
 *
 * The first frame is the route's own `connected` greeting, pushed by the caller.
 */
export function attachObserverStream(state: ObserverConnectionState, ws: ObserverSocket): ObserverStream {
  // Elysia exposes the server socket untyped. Both members are optional, so an
  // absent one degrades (no byte count / no keepalive) instead of failing.
  const raw = (ws.raw ?? {}) as ObserverRawSocket;

  const teardown = (): void => {
    if (state.closed) return;
    state.closed = true;
    state.coalescer?.dispose();
    state.coalescer = null;
    if (state.heartbeat !== null) {
      clearInterval(state.heartbeat);
      state.heartbeat = null;
    }
    if (state.unsubscribe) {
      try {
        state.unsubscribe();
      } catch {
        // Subscriber cleanup is best-effort.
      }
      state.unsubscribe = null;
    }
    try {
      ws.close();
    } catch {
      // Already gone.
    }
  };

  state.coalescer = createEventCoalescer({
    send: (_event, data) => {
      try {
        ws.send(JSON.stringify(data));
      } catch {
        teardown();
      }
    },
    isBackpressured: () => (raw.bufferedAmount ?? 0) > HIGH_WATER_BYTES,
    flushDelayMs: FLUSH_DELAY_MS,
  });

  // Protocol-level keepalive: a client that misses a full ping cycle is gone,
  // and a live one answers without any application-level traffic. The pong
  // arrives on the route's `pong` handler, which clears `awaitingPong` through
  // the SAME state object.
  state.heartbeat = setInterval(() => {
    if (state.closed) return;
    if (state.awaitingPong) {
      teardown();
      return;
    }
    state.awaitingPong = true;
    if (!state.coalescer?.flush()) return;
    try {
      raw.ping?.();
    } catch {
      teardown();
    }
  }, STREAM_HEARTBEAT_MS);

  state.teardown = teardown;
  return { push: (event, data) => state.coalescer?.push(event, data) };
}
