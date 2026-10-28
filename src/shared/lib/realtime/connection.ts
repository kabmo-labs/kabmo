/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The socket lifecycle for the unified realtime channel: dial, backoff, the
 * resume probe, and teardown.
 *
 * The state it moves lives in `state.ts` (and on `globalThis`, so a dev HMR
 * re-evaluation adopts the live socket instead of opening a second one). The
 * topic bookkeeping — sequence tracking, gap detection, snapshots — lives in
 * `client.ts`.
 *
 * ## Why a dial needs a timeout
 *
 * A dial is not guaranteed to end. Measured: a socket can sit in CONNECTING
 * with no `open`, `error` or `close` at all (a listener that has bound but is
 * not accepting, or a proxy that swallows the upgrade). Backoff is driven by
 * `close`, so without an explicit deadline the channel would sit dead forever
 * while the tab reports "connecting".
 *
 * ## Why the channel never gives up, and why it listens for the tab coming back
 *
 * A phone freezes a backgrounded tab: its timers stop, and the server's 30s
 * heartbeat tears the socket down because the frozen tab cannot answer a ping.
 * By the time the tab is visible again the radio may still be waking from Doze,
 * which is long enough to spend the whole FAST retry budget — and that used to
 * be terminal (`error` with no timer, and `connectIfNeeded` refusing to dial
 * from `error`), so the indicator stayed red and only a page reload repaired
 * the stream. Three rules replace it:
 *
 *   - the fast budget is only a CADENCE (past it the channel keeps trying at
 *     `SLOW_RETRY_MS`);
 *   - coming back to the tab or the network resets the budget and dials at
 *     once, because that event is the strongest evidence a dial can succeed;
 *   - a socket the browser still reports OPEN is PROBED rather than trusted,
 *     since a frozen tab never learns that the server hung up.
 */

import { realtimeSocketUrl } from '@/shared/lib/realtime/protocol';
import { createResumeWatch } from '@/shared/lib/realtime/resume';
import {
  deliverFrame,
  liveTopics,
  notifyClosed,
  send,
  setStatus,
  setWanted,
  state,
} from '@/shared/lib/realtime/state';

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8_000;
/** Consecutive re-dials that never opened before the fast budget is spent. */
const MAX_FAILED_DIALS = 4;
/**
 * The cadence once the fast budget is spent. Not a give-up: a tab that comes
 * back with no `visibilitychange` (a phone that never left the page, a resumed
 * bfcache document) still repairs itself within one interval.
 */
const SLOW_RETRY_MS = 30_000;
/** How long a dial may sit in CONNECTING before it is abandoned and retried. */
const CONNECT_TIMEOUT_MS = 10_000;

/**
 * Resume, watchdog and liveness probe live in `resume.ts`: they are the
 * mechanism that repairs a connection the browser never reported dead, and they
 * need `dial` — which this module owns — so the dependency is injected rather
 * than imported back.
 */
const resumeWatch = createResumeWatch(() => dial());

/** The tab (or the app, or the radio) is back. See `resume.ts`. */
export const wake = resumeWatch.wake;

/**
 * The server answered a resume probe: the socket really is alive. Called from
 * the topic layer's frame switch, which already decoded the frame — decoding a
 * second time here would double the parse cost of every streamed frame.
 */
export function notePong(id: number): void {
  const host = state();
  if (host.probeId !== id) return;
  host.probeId = undefined;
  clearTimeout(host.probeTimer);
  host.probeTimer = undefined;
  host.lastInboundAt = Date.now();
}

function scheduleReconnect(): void {
  const host = state();
  if (!host.wanted || host.retryTimer !== undefined) return;
  // Past the fast budget the channel keeps trying — it does not give up. A tab
  // that never receives a `visibilitychange` (a resumed bfcache document, a
  // phone whose page was never actually hidden) still repairs itself here.
  const delay = host.failures < MAX_FAILED_DIALS
    ? Math.min(RECONNECT_BASE_MS * 2 ** host.failures, RECONNECT_MAX_MS)
    : SLOW_RETRY_MS;
  host.retryTimer = window.setTimeout(() => {
    host.retryTimer = undefined;
    dial();
  }, delay);
}
function dial(): void {
  const host = state();
  // A retry scheduled before the last subscriber left must not open a socket
  // nobody wants: `onopen` would subscribe the empty live set and the
  // connection would then sit open for the life of the tab.
  if (!host.wanted) return;
  if (host.socket) return;
  if (typeof window === 'undefined') return;

  setStatus('connecting');
  const Ctor = host.socketCtor ?? WebSocket;
  let socket: WebSocket;
  try {
    socket = new Ctor(realtimeSocketUrl());
  } catch {
    host.failures += 1;
    scheduleReconnect();
    return;
  }
  host.socket = socket;
  let opened = false;

  // Abandon a dial that never settles. Closing it fires `onclose`, which owns
  // the retry decision — the same path a refused or dropped connection takes.
  const connectTimer = window.setTimeout(() => {
    if (opened || host.socket !== socket) return;
    try {
      socket.close();
    } catch {
      // Already gone.
    }
  }, CONNECT_TIMEOUT_MS);

  socket.onopen = () => {
    opened = true;
    clearTimeout(connectTimer);
    host.failures = 0;
    // The socket just proved it is alive; the idle clock starts here so the
    // watchdog does not probe a connection opened a moment ago.
    host.lastInboundAt = Date.now();
    if (host.probeId !== undefined) {
      host.probeId = undefined;
      clearTimeout(host.probeTimer);
      host.probeTimer = undefined;
    }
    setStatus('open');
    // Resubscribe the live set: the server answers each with a fresh snapshot,
    // which is the repair for everything missed while the socket was down.
    const topics = liveTopics();
    if (topics.length > 0) send({ t: 'subscribe', topics });
  };

  socket.onmessage = (event) => {
    if (typeof event.data !== 'string') return;
    // The idle clock the watchdog reads: every inbound frame — a delta, a
    // snapshot, a pong — proves the socket is alive.
    host.lastInboundAt = Date.now();
    deliverFrame(event.data);
  };

  socket.onclose = () => {
    clearTimeout(connectTimer);
    // A socket that has already been REPLACED must not report on the connection
    // it no longer owns: the resume path dials a fresh one while the frozen
    // socket's `close` is still in flight, and nulling the live socket there
    // would orphan it and dial a third.
    if (host.socket !== socket) return;
    host.socket = null;
    if (host.probeId !== undefined) {
      host.probeId = undefined;
      clearTimeout(host.probeTimer);
      host.probeTimer = undefined;
    }
    if (!opened) host.failures += 1;
    setStatus('closed');
    // Every value is now of unknown age; the resubscribe on reopen is the
    // repair, and this is what tells the UI to say so meanwhile.
    notifyClosed();
    scheduleReconnect();
  };

  socket.onerror = () => {
    // `onclose` always follows, and owns the retry decision.
  };
}

/** Open the socket when something wants it and nothing is dialing. */
export function connectIfNeeded(): void {
  const host = state();
  setWanted(liveTopics().length > 0);
  if (!host.wanted) return;
  resumeWatch.ensureListeners();
  resumeWatch.start();
  if (host.socket) return;
  if (host.retryTimer !== undefined) return;
  dial();
}

/** Test seam: close the socket and forget the connection state. */
export function resetConnection(): void {
  const host = state();
  // Removes the resume listeners AND stops the watchdog. The watch nulls its own
  // slots before running the cleanup, so a throwing listener target cannot leave
  // them set and make the next reset retry the same throw.
  resumeWatch.stop();
  clearTimeout(host.retryTimer);
  clearTimeout(host.probeTimer);
  const socket = host.socket;
  host.socket = null;
  try {
    socket?.close();
  } catch {
    // Already gone.
  }
  globalThis.__kabmoRealtimeConnection = undefined;
}
