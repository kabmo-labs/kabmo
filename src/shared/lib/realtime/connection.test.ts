/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The channel's retry lifecycle, pinned where a phone broke it.
 *
 * A backgrounded Android tab freezes: its timers stop and the server's 30s
 * heartbeat drops the socket. The old shape spent a 4-dial budget in the first
 * ~7s after the tab returned — often before the radio woke from Doze — then
 * latched `error` with no timer and no way back, so the indicator stayed red and
 * only a reload repaired the stream. These cases pin the replacement: a slow
 * cadence instead of a give-up, a resume event that resets the budget and dials
 * at once, and a liveness probe for a socket the browser still reports OPEN.
 *
 * Driven through the PUBLIC client (`subscribe`), so the wiring under test is
 * the one production uses; the socket is a double only because a real one would
 * need a server.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'bun:test';
import { Window } from 'happy-dom';

import { realtimeClient, resetRealtimeClient } from '@/shared/lib/realtime/client';
import { currentStatus } from '@/shared/lib/realtime/state';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

const RETRY_AFTER_ESTABLISHED_DROP_MS = 500;
const FAST_RETRIES_MS = [1_000, 2_000, 4_000];
const SLOW_RETRY_MS = 30_000;
const WAKE_PROBE_MS = 2_000;

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

  /** The socket dies and the browser delivers `close`. */
  drop(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  /**
   * The server tore the connection down while the tab was frozen. The BROWSER
   * never learned: `readyState` still says OPEN, which is exactly why a resume
   * cannot trust it.
   */
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

let win: Window;
let doc: Document;
let hidden = false;
let unsubscribe: (() => void) | null = null;

beforeEach(() => {
  FakeSocket.instances = [];
  hidden = false;
  win = new Window({ url: 'http://localhost' });
  // `vi.useFakeTimers` patches the RUNNER's globals, while happy-dom captured
  // its own bound copies when it was imported. Delegating at call time is what
  // lets the channel's `window.setTimeout` be driven deterministically.
  win.setTimeout = ((fn: () => void, ms?: number) =>
    globalThis.setTimeout(fn, ms)) as unknown as typeof win.setTimeout;
  win.clearTimeout = ((id?: number) => globalThis.clearTimeout(id)) as unknown as typeof win.clearTimeout;
  installDomGlobals(win);
  doc = document;
  Object.defineProperty(doc, 'hidden', { configurable: true, get: () => hidden });
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

/**
 * A happy-dom event handed to the DOM's own `dispatchEvent`. The two `Event`
 * types are structurally incompatible on paper (happy-dom's carries its own
 * private symbols) while being the same object at runtime, so the cast is the
 * only honest way to name it once.
 */
function winEvent(type: string): Event {
  return new win.Event(type) as unknown as Event;
}

function subscribe(): void {
  unsubscribe = realtimeClient.subscribe('probe:topic', () => {});
}

function resumeTab(): void {
  hidden = false;
  doc.dispatchEvent(winEvent('visibilitychange'));
}

function lastSocket(): FakeSocket {
  return FakeSocket.instances[FakeSocket.instances.length - 1]!;
}

/** Spend the fast budget: one established drop, then dials that never open. */
function exhaustFastBudget(): void {
  subscribe();
  lastSocket().open();
  lastSocket().drop();
  vi.advanceTimersByTime(RETRY_AFTER_ESTABLISHED_DROP_MS);
  for (const wait of FAST_RETRIES_MS) {
    lastSocket().drop();
    vi.advanceTimersByTime(wait);
  }
  lastSocket().drop();
}

describe('realtime channel retry lifecycle', () => {
  test('a dial is opened by the first subscription', () => {
    subscribe();
    expect(FakeSocket.instances).toHaveLength(1);
    expect(currentStatus()).toBe('connecting');
  });

  test('the fast budget is a cadence, not a give-up', () => {
    exhaustFastBudget();
    // Five dials spent the fast budget. The old code stopped here and latched
    // `error` for the rest of the page's life.
    expect(FakeSocket.instances).toHaveLength(5);
    expect(currentStatus()).toBe('closed');

    vi.advanceTimersByTime(SLOW_RETRY_MS - 1);
    expect(FakeSocket.instances).toHaveLength(5);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(6);
    expect(currentStatus()).toBe('connecting');
  });

  test('returning to the tab resets the budget and dials immediately', () => {
    exhaustFastBudget();
    expect(FakeSocket.instances).toHaveLength(5);

    // No clock advance at all: the resume event is the evidence a dial can
    // succeed now, and a phone waking from Doze must not wait 30s.
    resumeTab();
    expect(FakeSocket.instances).toHaveLength(6);
    expect(currentStatus()).toBe('connecting');

    // The budget was reset, so the next retry is fast rather than slow.
    lastSocket().drop();
    vi.advanceTimersByTime(1_000);
    expect(FakeSocket.instances).toHaveLength(7);
  });

  test('a resumed tab probes a socket the browser still reports OPEN', () => {
    subscribe();
    const frozen = lastSocket();
    frozen.open();
    frozen.silentDeath();

    resumeTab();
    // Trusting `readyState` would keep the indicator green over a stream the
    // server already tore down; the probe is what can tell them apart.
    expect(FakeSocket.instances).toHaveLength(1);
    expect(frozen.frames().filter((frame) => frame.t === 'ping')).toEqual([{ t: 'ping', id: 1 }]);
    expect(currentStatus()).toBe('open');

    // No answer within the deadline: the socket is abandoned and a fresh dial
    // follows the normal retry path.
    vi.advanceTimersByTime(WAKE_PROBE_MS);
    vi.advanceTimersByTime(RETRY_AFTER_ESTABLISHED_DROP_MS);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  test('an answered probe keeps the connection as it is', () => {
    subscribe();
    const socket = lastSocket();
    socket.open();
    resumeTab();
    // `onopen` subscribed the live topic first, so the probe is the PING frame.
    const ping = socket.frames().find((frame) => frame.t === 'ping') as { id: number } | undefined;
    expect(ping).toBeDefined();
    socket.onmessage?.({ data: JSON.stringify({ t: 'pong', id: ping!.id }) });

    // Short of the idle-probe window: an answered probe must not cause a
    // reconnect of its own. (Past `IDLE_PROBE_AFTER_MS` the watchdog probes
    // again by design — see the idle case below.)
    vi.advanceTimersByTime(20_000);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(currentStatus()).toBe('open');
  });

  test('a hidden tab dials nothing', () => {
    subscribe();
    lastSocket().open();
    lastSocket().drop();
    const before = FakeSocket.instances.length;

    hidden = true;
    doc.dispatchEvent(winEvent('visibilitychange'));
    expect(FakeSocket.instances).toHaveLength(before);
  });

  test('a bfcache restore and a returning network also wake the channel', () => {
    subscribe();
    lastSocket().open();
    lastSocket().drop();

    win.dispatchEvent(winEvent('pageshow') as unknown as Parameters<typeof win.dispatchEvent>[0]);
    expect(FakeSocket.instances).toHaveLength(2);
    lastSocket().drop();

    win.dispatchEvent(winEvent('online') as unknown as Parameters<typeof win.dispatchEvent>[0]);
    expect(FakeSocket.instances).toHaveLength(3);
  });

  test('a replaced socket reporting its own close does not orphan the new dial', () => {
    subscribe();
    const frozen = lastSocket();
    frozen.open();
    frozen.silentDeath();
    resumeTab();
    vi.advanceTimersByTime(WAKE_PROBE_MS);
    vi.advanceTimersByTime(RETRY_AFTER_ESTABLISHED_DROP_MS);
    const live = lastSocket();
    expect(live).not.toBe(frozen);

    // The frozen socket's `close` finally arrives. It must not null the live
    // socket or schedule a retry for a connection it no longer owns — the new
    // dial keeps its own 10s connect deadline and nothing else.
    frozen.onclose?.();
    expect(currentStatus()).toBe('connecting');
    vi.advanceTimersByTime(5_000);
    expect(FakeSocket.instances).toHaveLength(2);
    expect(lastSocket()).toBe(live);
  });

  test('nothing is dialed once every subscription is released', () => {
    subscribe();
    lastSocket().open();
    lastSocket().drop();
    unsubscribe?.();
    unsubscribe = null;
    const before = FakeSocket.instances.length;

    resumeTab();
    vi.advanceTimersByTime(SLOW_RETRY_MS * 2);
    expect(FakeSocket.instances).toHaveLength(before);
  });

  test('a reset removes the resume listeners', () => {
    subscribe();
    lastSocket().open();
    lastSocket().drop();
    resetRealtimeClient();
    const before = FakeSocket.instances.length;

    resumeTab();
    expect(FakeSocket.instances).toHaveLength(before);
  });

  test('a reset after the DOM globals are gone does not throw', () => {
    // The teardown seam runs in a suite's `afterEach` and its globals are
    // restored in `afterAll`, so the order is not always the one this file
    // uses. Dereferencing `document` when the cleanup runs threw
    // `ReferenceError: document is not defined` and failed the NEXT file — a
    // suite that names none of the files responsible. Measured on CI, where it
    // took out 17 cases across two files.
    subscribe();
    lastSocket().open();
    restoreDomGlobals();
    expect(() => resetRealtimeClient()).not.toThrow();
  });
});

