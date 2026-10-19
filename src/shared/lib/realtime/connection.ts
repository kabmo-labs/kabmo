/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
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
import {
  WS_CONNECTING,
  WS_OPEN,
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
 * How long a socket that LOOKS open has to answer a resume probe. A frozen tab
 * keeps `readyState === OPEN` for a connection the server already tore down, so
 * the only trustworthy answer is the server's own pong.
 */
const WAKE_PROBE_MS = 2_000;

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

/**
 * Ask a socket that LOOKS open whether it still is.
 *
 * A frozen tab keeps `readyState === OPEN` for a connection the server's
 * heartbeat already tore down, and no `close` is delivered until the browser
 * notices. Without this probe the resume path would trust a corpse and the
 * indicator would stay green over a stream that never resumes.
 */
function probeLiveness(socket: WebSocket): void {
  const host = state();
  if (host.probeId !== undefined) return;
  const id = (host.probeSeq += 1);
  host.probeId = id;
  const abandon = (): void => {
    // A late answer from a socket that has since been replaced must not close
    // the live one: the deadline is only ever about THIS socket.
    if (host.probeId !== id) return;
    host.probeId = undefined;
    host.probeTimer = undefined;
    if (host.socket !== socket) return;
    try {
      socket.close();
    } catch {
      // Already gone.
    }
  };
  host.probeTimer = window.setTimeout(abandon, WAKE_PROBE_MS);
  if (!send({ t: 'ping', id })) abandon();
}

/**
 * The tab is back: a background freeze stopped our timers and the server's
 * heartbeat dropped the socket, so the failure count describes a window in
 * which nothing could run. Reset it and dial now if the socket is gone.
 *
 * Fires from `visibilitychange`, `pageshow` (bfcache) and `online` (the radio
 * can come back before the page is visible again). `online` also covers a
 * network that dropped without the tab ever hiding.
 */
function wake(): void {
  const host = state();
  if (!host.wanted) return;
  host.failures = 0;
  const socket = host.socket;
  if (socket && socket.readyState === WS_CONNECTING) return;
  if (socket && socket.readyState === WS_OPEN) {
    probeLiveness(socket);
    return;
  }
  if (host.retryTimer !== undefined) {
    clearTimeout(host.retryTimer);
    host.retryTimer = undefined;
  }
  if (socket) {
    // Nulled FIRST: `close()` delivers `onclose` synchronously in some engines,
    // and that handler owns the retry decision for a socket it still believes
    // in. This socket is being abandoned on purpose, so its late close must
    // report nothing.
    host.socket = null;
    try {
      socket.close();
    } catch {
      // Already gone.
    }
    // The server tore this connection down while the tab was frozen, so every
    // value on screen is of unknown age even though no `close` arrived.
    notifyClosed();
  }
  dial();
}

/**
 * Install the resume listeners once. A no-op outside a document.
 *
 * The cleanup closes over the `document`/`window` it REGISTERED on rather than
 * reading the globals again when it runs. Those are not necessarily the same
 * objects: a test suite replaces them per case and deletes them when it is
 * done, and `resetConnection` (the teardown seam) would then dereference an
 * absent `document` and throw — measured on CI, where a suite that reset the
 * client after its own `restoreDomGlobals` failed the NEXT file with
 * `ReferenceError: document is not defined`. In a browser the two are always
 * the same object, so this changes nothing there.
 */
function ensureWakeListeners(): void {
  const host = state();
  if (host.wakeCleanup) return;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const doc = document;
  const win = window;
  const onVisible = (): void => {
    if (!doc.hidden) wake();
  };
  const onOnline = (): void => wake();
  const onPageShow = (): void => wake();
  doc.addEventListener('visibilitychange', onVisible);
  win.addEventListener('online', onOnline);
  win.addEventListener('pageshow', onPageShow);
  host.wakeCleanup = () => {
    doc.removeEventListener('visibilitychange', onVisible);
    win.removeEventListener('online', onOnline);
    win.removeEventListener('pageshow', onPageShow);
  };
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
    if (typeof event.data === 'string') deliverFrame(event.data);
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
  ensureWakeListeners();
  if (host.socket) return;
  if (host.retryTimer !== undefined) return;
  dial();
}

/** Test seam: close the socket and forget the connection state. */
export function resetConnection(): void {
  const host = state();
  // Nulled BEFORE the call: a cleanup that throws (a listener target that is
  // already gone) must not leave the slot set, or the next reset retries the
  // same throw and the state below is never cleared.
  const cleanup = host.wakeCleanup;
  host.wakeCleanup = null;
  cleanup?.();
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
