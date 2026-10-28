/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Resume: the half of the channel's lifecycle that repairs a connection the
 * browser never told us was gone.
 *
 * Split from `connection.ts` (which owns dial, backoff and teardown) because a
 * phone broke the event-based half, and the two are now genuinely different
 * mechanisms. `connection.ts` reacts to events the PLATFORM delivers; this
 * module reacts to ones it does not.
 *
 * ## Why events alone are not enough
 *
 * A backgrounded Android tab is frozen: timers stop, and the server's 30s
 * protocol heartbeat tears the socket down because a frozen tab cannot answer a
 * ping. The repair used to depend on `visibilitychange`, `pageshow` or `online`.
 * Measured on the shipped Android shell, none of them reliably arrives: the
 * WebView is never reported hidden when the app goes to the background, so
 * returning to it fires no `visibilitychange`, and a socket the server reaped
 * while the page was frozen produces no `close` — the browser still reports
 * `readyState === OPEN`. The channel therefore sat on a corpse: status `open`,
 * no frames, the stream frozen mid-answer, and only a page reload repaired it.
 *
 * ## The watchdog
 *
 * A running interval is the one signal a frozen page cannot fake, because a
 * frozen page stops running it:
 *
 * - a tick that arrives much later than its deadline means the page was
 *   suspended, which is exactly the moment a resume has to be treated like one;
 * - an OPEN socket with no inbound traffic for `IDLE_PROBE_AFTER_MS` is probed
 *   even when nothing woke the page, which catches a connection that died while
 *   the tab stayed visible (a Wi-Fi to cellular handoff).
 *
 * Both branches are idempotent: a probe already in flight is left alone, and
 * `wake()` is a no-op on a healthy connection.
 */

import {
  WS_CONNECTING,
  WS_OPEN,
  notifyClosed,
  send,
  state,
} from '@/shared/lib/realtime/state';
import {
  LIVENESS_TICK_MS,
  watchdogAction,
} from '@/shared/lib/realtime/watchdog';

/**
 * How long a socket that LOOKS open has to answer a resume probe. A frozen tab
 * keeps `readyState === OPEN` for a connection the server already tore down, so
 * the only trustworthy answer is the server's own pong.
 */
const WAKE_PROBE_MS = 2_000;

/** Ask for a fresh socket. Injected by `connection.ts` so this module never
 *  imports the dial path back and the two stay acyclic. */
export type Dialer = () => void;

export interface ResumeWatch {
  /** Install the tab-resume listeners once (a no-op outside a document). */
  ensureListeners: () => void;
  /** Start the watchdog. Idempotent. */
  start: () => void;
  /** Stop the watchdog and remove the listeners. */
  stop: () => void;
  /** Treat the page as back: reset the budget, probe or re-dial. */
  wake: () => void;
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
  // A probe whose deadline passed while the page was frozen can never fire its
  // own abandon: the timer was frozen with it. Discard it rather than letting it
  // block every later probe — that is a socket that is never questioned and so
  // never replaced.
  if (host.probeId !== undefined && Date.now() - host.probeArmedAt > WAKE_PROBE_MS) {
    host.probeId = undefined;
    clearTimeout(host.probeTimer);
    host.probeTimer = undefined;
  }
  if (host.probeId !== undefined) return;
  const id = (host.probeSeq += 1);
  host.probeId = id;
  host.probeArmedAt = Date.now();
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

export function createResumeWatch(dial: Dialer): ResumeWatch {
  /**
   * The tab is back: a background freeze stopped our timers and the server's
   * heartbeat dropped the socket, so the failure count describes a window in
   * which nothing could run. Reset it and dial now if the socket is gone.
   */
  const wake = (): void => {
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
      // Nulled FIRST: `close()` delivers `onclose` synchronously in some
      // engines, and that handler owns the retry decision for a socket it still
      // believes in. This socket is being abandoned on purpose, so its late
      // close must report nothing.
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
  };

  /**
   * Install the resume listeners once. A no-op outside a document.
   *
   * The cleanup closes over the `document`/`window` it REGISTERED on rather than
   * reading the globals again when it runs. Those are not necessarily the same
   * objects: a test suite replaces them per case and deletes them when it is
   * done, and the teardown would then dereference an absent `document` and throw
   * — measured on CI, where a suite that reset the client after its own
   * `restoreDomGlobals` failed the NEXT file with `ReferenceError: document is
   * not defined`. In a browser the two are always the same object.
   */
  const ensureListeners = (): void => {
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
  };

  const start = (): void => {
    const host = state();
    if (host.livenessTimer !== undefined) return;
    if (typeof window === 'undefined') return;
    let lastTick = Date.now();
    host.livenessTimer = window.setInterval(() => {
      const now = Date.now();
      const sinceTick = now - lastTick;
      lastTick = now;
      const socket = host.socket;
      const action = watchdogAction({
        sinceTick,
        sinceInbound: now - host.lastInboundAt,
        hidden: document.hidden,
        open: socket?.readyState === WS_OPEN,
        wanted: host.wanted,
      });
      if (action === 'wake') wake();
      else if (action === 'probe' && socket) probeLiveness(socket);
    }, LIVENESS_TICK_MS);
  };

  const stop = (): void => {
    const host = state();
    // Nulled BEFORE the call: a cleanup that throws (a listener target that is
    // already gone) must not leave the slot set, or the next stop retries the
    // same throw.
    const cleanup = host.wakeCleanup;
    host.wakeCleanup = null;
    cleanup?.();
    if (host.livenessTimer !== undefined) {
      clearInterval(host.livenessTimer);
      host.livenessTimer = undefined;
    }
  };

  return { ensureListeners, start, stop, wake };
}
