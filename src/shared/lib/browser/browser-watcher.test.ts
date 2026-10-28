/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/** The owned-target watcher half of : the registry
 * confirms page ownership before a target is reported. Split verbatim so
 * both files stay under the repo's 350-line ceiling; the shared fakes ride
 * along because the file must stand alone. */

import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { watchOwnedTargets } from '@/shared/lib/browser/watcher';
import { pristineWebSocket } from '@/test-support/pristine-globals';

interface Listener {
  handler: (event: unknown) => void;
  once: boolean;
}

/** A WebSocket that answers CDP commands from a canned `replies` table. */
class FakeSocket {
  static instances: FakeSocket[] = [];
  static replies = new Map<string, unknown>();
  static autoOpen = true;
  readonly url: string;
  readonly sent: string[] = [];
  closed = false;
  private readonly listeners = new Map<string, Listener[]>();

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
    if (FakeSocket.autoOpen) queueMicrotask(() => this.emit('open', {}));
  }

  addEventListener(type: string, handler: (event: unknown) => void, opts?: { once?: boolean }): void {
    const list = this.listeners.get(type) ?? [];
    list.push({ handler, once: opts?.once ?? false });
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, handler: (event: unknown) => void): void {
    const list = this.listeners.get(type);
    if (!list) return;
    this.listeners.set(
      type,
      list.filter((entry) => entry.handler !== handler),
    );
  }

  emit(type: string, event: unknown): void {
    const list = this.listeners.get(type);
    if (!list) return;
    for (const entry of [...list]) {
      if (entry.once) this.removeEventListener(type, entry.handler);
      entry.handler(event);
    }
  }

  send(raw: string): void {
    this.sent.push(raw);
    const frame = JSON.parse(raw) as { id: number; method: string };
    if (!FakeSocket.replies.has(frame.method)) return;
    const result = FakeSocket.replies.get(frame.method);
    queueMicrotask(() => this.emit('message', { data: JSON.stringify({ id: frame.id, result }) }));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.emit('close', {});
  }

  /** Every frame this socket received, parsed. */
  frames(): Array<Record<string, unknown>> {
    return this.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
  }

  reply(id: number, payload: Record<string, unknown>): void {
    this.emit('message', { data: JSON.stringify({ id, ...payload }) });
  }
}

const globals = globalThis as unknown as Record<string, unknown>;
const DOM_GLOBALS = ['WebSocket', 'window', 'document', 'CustomEvent'] as const;
/** The runner's own globals, captured before the first stub is written so
 *  `afterEach` can put them back — deleting `CustomEvent` here stripped a
 *  native every later file needs. */
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
let captured = false;

beforeEach(() => {
  if (!captured) {
    captured = true;
    for (const key of DOM_GLOBALS) nativeGlobals[key] = globals[key];
  }
  nativeGlobals.WebSocket = pristineWebSocket;   // never the fake another suite left
  globals.WebSocket = FakeSocket;
  FakeSocket.instances = [];
  FakeSocket.replies = new Map();
  FakeSocket.autoOpen = true;
  delete globals.__ompBrowserConnections;
  delete globals.__ompBrowserPendingConnects;
});

afterEach(() => {
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete globals[key];
    else globals[key] = nativeGlobals[key];
  }
});


/** Drain pending microtasks (async continuations, `queueMicrotask`) without a clock. */
async function flush(ticks = 12): Promise<void> {
  for (let i = 0; i < ticks; i += 1) await Promise.resolve();
}

/** Drive fake timers in steps so each resumed async iteration can schedule the next. */
async function runTimers(steps = 10, msPerStep = 100): Promise<void> {
  for (let i = 0; i < steps; i += 1) {
    jest.advanceTimersByTime(msPerStep);
    await flush(20);
  }
}

describe('owned-target watcher', () => {
  async function watch(owned: () => Promise<string[]>): Promise<{ got: string[]; socket: FakeSocket; close: () => void }> {
    FakeSocket.replies.set('Target.setDiscoverTargets', {});
    const got: string[] = [];
    const handle = await watchOwnedTargets('ws://watcher-test', { getOwnedTargetIds: owned, onOwnedTarget: (id) => got.push(id) });
    return { got, socket: FakeSocket.instances.at(-1) as FakeSocket, close: handle.close };
  }

  const created = (socket: FakeSocket, targetInfo: Record<string, unknown>) =>
    socket.emit('message', { data: JSON.stringify({ method: 'Target.targetCreated', params: { targetInfo } }) });

  test('reports a page only after the registry confirms ownership', async () => {
    const { got, socket, close } = await watch(async () => ['t-owned']);
    created(socket, { targetId: 't-owned', type: 'page' });
    await flush();
    expect(got).toEqual(['t-owned']);
    close();
  });

  test('ignores non-page targets and repeats of the same id', async () => {
    const { got, socket, close } = await watch(async () => ['t-page']);
    created(socket, { targetId: 't-worker', type: 'service_worker' });
    created(socket, { targetId: 't-page', type: 'page' });
    created(socket, { targetId: 't-page', type: 'page' });
    await flush();
    expect(got).toEqual(['t-page']);
    close();
  });

  test('retries while the registry write trails the event', async () => {
    let attempts = 0;
    const { got, socket, close } = await watch(async () => {
      attempts += 1;
      return attempts >= 2 ? ['t-late'] : [];
    });
    jest.useFakeTimers();
    try {
      created(socket, { targetId: 't-late', type: 'page' });
      await flush();
      expect(got).toEqual([]);
      await runTimers();
      expect(got).toEqual(['t-late']);
    } finally {
      jest.useRealTimers();
    }
    close();
  });

  test('never reports a target the session does not own', async () => {
    let attempts = 0;
    const { got, socket, close } = await watch(async () => {
      attempts += 1;
      return ['someone-else'];
    });
    jest.useFakeTimers();
    try {
      created(socket, { targetId: 't-foreign', type: 'page' });
      await runTimers();
      // The retry budget is exhausted, so the negative is a real verdict.
      expect(attempts).toBe(8);
      expect(got).toEqual([]);
    } finally {
      jest.useRealTimers();
    }
    close();
  });

  test('close releases the shared socket and stops reporting', async () => {
    const { got, socket, close } = await watch(async () => ['t-owned']);
    close();
    created(socket, { targetId: 't-owned', type: 'page' });
    await flush();
    expect(got).toEqual([]);
    expect(socket.closed).toBe(true);
  });
});
