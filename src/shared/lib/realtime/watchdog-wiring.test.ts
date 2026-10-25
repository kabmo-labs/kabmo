/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The watchdog's WIRING, driven through the interval the client really runs.
 *
 * The DECISION (freeze versus silence versus throttling) is pinned in
 * `watchdog.test.ts`, where a timing rule can be asserted without a clock. What
 * is left here is that the interval exists, that it reaches the client's own
 * probe and re-dial paths, and that its clocks come from the socket's real
 * traffic — the parts a pure function cannot cover.
 *
 * The reported failure these exist for: a backgrounded Android WebView fires no
 * `visibilitychange` on return, and a socket the server's 30s heartbeat reaped
 * while the page was frozen produces no `close` — `readyState` still says OPEN.
 * The channel sat on a corpse with no frames, the stream frozen mid-answer, and
 * only a page reload repaired it.
 *
 * Driven through the PUBLIC client (`subscribe`), so the wiring under test is
 * the one production uses; the socket is a double only because these cases are
 * about what the client does with a socket that stops answering.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'bun:test';
import { Window } from 'happy-dom';

import { realtimeClient, resetRealtimeClient } from '@/shared/lib/realtime/client';
import { currentStatus, state } from '@/shared/lib/realtime/state';
import { IDLE_PROBE_AFTER_MS } from '@/shared/lib/realtime/watchdog';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

/** A socket whose answer the case decides, and whose frames are inspectable. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  /** The server reaped it while the page was frozen: the browser never learned. */
  silentDeath(): void {
    this.readyState = 1;
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.();
  }

  frames(): Array<Record<string, unknown>> {
    return this.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
  }
}

const WAKE_PROBE_MS = 2_000;
const RETRY_AFTER_ESTABLISHED_DROP_MS = 500;

let win: Window;
let unsubscribe: (() => void) | null = null;

beforeEach(() => {
  FakeSocket.instances = [];
  win = new Window({ url: 'http://localhost' });
  // `vi.useFakeTimers` patches the RUNNER's globals, while happy-dom captured
  // its own bound copies when it was imported. Delegating at call time is what
  // lets the watchdog's `window.setInterval` be driven deterministically.
  win.setTimeout = ((fn: () => void, ms?: number) =>
    globalThis.setTimeout(fn, ms)) as unknown as typeof win.setTimeout;
  win.clearTimeout = ((id?: number) => globalThis.clearTimeout(id)) as unknown as typeof win.clearTimeout;
  win.setInterval = ((fn: () => void, ms?: number) =>
    globalThis.setInterval(fn, ms)) as unknown as typeof win.setInterval;
  win.clearInterval = ((id?: number) => globalThis.clearInterval(id)) as unknown as typeof win.clearInterval;
  installDomGlobals(win);
  realtimeClient.setSocketConstructor(FakeSocket as unknown as typeof WebSocket);
  vi.useFakeTimers();
});

afterEach(() => {
  unsubscribe?.();
  unsubscribe = null;
  resetRealtimeClient();
  vi.useRealTimers();
  restoreDomGlobals();
});

function subscribe(): void {
  unsubscribe = realtimeClient.subscribe('probe:topic', () => {});
}

function lastSocket(): FakeSocket {
  return FakeSocket.instances[FakeSocket.instances.length - 1]!;
}

describe('the liveness watchdog', () => {
  test('a silent open socket is probed without any resume event', () => {
    subscribe();
    const socket = lastSocket();
    socket.open();
    // No `visibilitychange`, no `pageshow`, no `online`: only time passing.
    vi.advanceTimersByTime(IDLE_PROBE_AFTER_MS);

    expect(socket.frames().filter((frame) => frame.t === 'ping')).toHaveLength(1);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(currentStatus()).toBe('open');
  });

  test('a probe that is never answered replaces the socket', () => {
    subscribe();
    const socket = lastSocket();
    socket.open();
    vi.advanceTimersByTime(IDLE_PROBE_AFTER_MS);
    expect(socket.frames().filter((frame) => frame.t === 'ping')).toHaveLength(1);

    // No pong: the deadline abandons the socket and the retry path dials.
    vi.advanceTimersByTime(WAKE_PROBE_MS);
    vi.advanceTimersByTime(RETRY_AFTER_ESTABLISHED_DROP_MS);
    expect(FakeSocket.instances).toHaveLength(2);
    expect(lastSocket()).not.toBe(socket);
  });

  test('a probe that IS answered leaves the connection alone', () => {
    subscribe();
    const socket = lastSocket();
    socket.open();
    vi.advanceTimersByTime(IDLE_PROBE_AFTER_MS);
    const ping = socket.frames().find((frame) => frame.t === 'ping') as { id: number };
    socket.onmessage?.({ data: JSON.stringify({ t: 'pong', id: ping.id }) });

    // The pong restarted the idle clock, so the next window is quiet again.
    vi.advanceTimersByTime(IDLE_PROBE_AFTER_MS - WAKE_PROBE_MS);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(currentStatus()).toBe('open');
  });

  test('real traffic keeps the socket out of the idle probe', () => {
    subscribe();
    const socket = lastSocket();
    socket.open();
    // A quiet-but-healthy connection: deltas and the server's own heartbeat keep
    // the clock fresh, so the watchdog must never question it.
    for (let elapsed = 0; elapsed < IDLE_PROBE_AFTER_MS * 2; elapsed += 5_000) {
      socket.onmessage?.({ data: JSON.stringify({ t: 'pong', id: 999 }) });
      vi.advanceTimersByTime(5_000);
    }
    expect(socket.frames().filter((frame) => frame.t === 'ping')).toHaveLength(0);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  test('the watchdog stops with the last subscription', () => {
    subscribe();
    const socket = lastSocket();
    socket.open();
    unsubscribe?.();
    unsubscribe = null;

    const before = FakeSocket.instances.length;
    vi.advanceTimersByTime(IDLE_PROBE_AFTER_MS * 2);
    expect(socket.frames().filter((frame) => frame.t === 'ping')).toHaveLength(0);
    expect(FakeSocket.instances).toHaveLength(before);
  });

  test('a reset stops the watchdog', () => {
    subscribe();
    const socket = lastSocket();
    socket.open();
    resetRealtimeClient();

    vi.advanceTimersByTime(IDLE_PROBE_AFTER_MS * 2);
    expect(socket.frames().filter((frame) => frame.t === 'ping')).toHaveLength(0);
  });

  test('a probe armed before a freeze does not block every later probe', () => {
    subscribe();
    const socket = lastSocket();
    socket.open();

    // A probe is armed, then the page freezes before its own deadline can fire —
    // and a frozen page freezes that deadline timer WITH it, so `probeId` stays
    // set with nothing left to clear it. Both halves are written directly: fake
    // timers fire the deadline on schedule, so advancing the clock cannot
    // produce this state.
    socket.silentDeath();
    const host = state();
    host.probeId = 99;
    host.probeArmedAt = Date.now() - (WAKE_PROBE_MS + IDLE_PROBE_AFTER_MS);
    clearTimeout(host.probeTimer);
    host.probeTimer = undefined;

    // The next watchdog probe must discard that stale arm rather than return
    // early on it: an armed-but-unanswerable probe that blocks every later one is
    // a socket that is never questioned, so nothing ever re-dials.
    vi.advanceTimersByTime(IDLE_PROBE_AFTER_MS);
    expect(socket.frames().filter((frame) => frame.t === 'ping')).toHaveLength(1);

    // And this one DOES get its deadline, so the dead socket is replaced.
    vi.advanceTimersByTime(WAKE_PROBE_MS);
    vi.advanceTimersByTime(RETRY_AFTER_ESTABLISHED_DROP_MS);
    expect(lastSocket()).not.toBe(socket);
  });
});
