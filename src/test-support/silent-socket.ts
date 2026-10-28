/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A `WebSocket` that never dials, and the teardown pair that goes with it.
 *
 * A suite that mounts a component reading a realtime topic subscribes to the
 * unified channel on mount, and `dial()` then constructs a real socket from
 * `window.location`. Two failure shapes follow, and both are reported against
 * whichever file runs NEXT rather than the one that caused them:
 *
 * - a happy-dom window created with no URL reports `about:blank`, whose origin
 *   is `null`, so `realtimeSocketUrl()` produces `ws:///api/realtime/ws`. Bun
 *   constructs that object without complaint and fails it ASYNCHRONOUSLY, after
 *   the suite has already restored the DOM globals — measured as
 *   `Unhandled error. (ErrorEvent { isTrusted: [Getter] })` between tests, and
 *   then as `Cannot call beforeAll() after the test run has completed` in the
 *   next file, because the error tears the run down mid-file.
 * - a window WITH an origin dials a port nothing listens on, which fails the
 *   same way (a refused connection is also asynchronous).
 *
 * `resetRealtimeClient()` in `afterEach` is not enough on its own: it closes a
 * socket that already exists, and the dial's own failure has not been delivered
 * yet. Silencing the CONSTRUCTOR is what removes the failure at its source.
 *
 * The subject of such a suite is its own markup, never the channel, so this
 * stub sends nothing and reports nothing. A suite that really drives the
 * channel uses `startRealtimeTestServer` instead, which injects the runner's
 * own `WebSocket` (see `pristineWebSocket`).
 */

import { realtimeClient, resetRealtimeClient } from '@/shared/lib/realtime/client';

/** `WebSocket.CLOSING` / `CLOSED`, spelled out: the client reads them off the
 *  instance, and this object need not carry the statics. */
class SilentSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = SilentSocket.CLOSED;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  send(): void {}
  close(): void {}
}

/**
 * Point the channel at `SilentSocket`. Call it BEFORE mounting anything that
 * subscribes — a dial that already happened is not retracted by this.
 */
export function silenceRealtime(): void {
  realtimeClient.setSocketConstructor(SilentSocket as unknown as typeof WebSocket);
}

/**
 * Undo `silenceRealtime` and drop the channel's state. This is the `afterEach`
 * half: the constructor goes back to `null` (the real global) so the next file
 * is not left silenced, and the reset clears the topic cache the stubbed
 * channel accumulated.
 */
export function restoreRealtime(): void {
  resetRealtimeClient();
  realtimeClient.setSocketConstructor(null);
}
