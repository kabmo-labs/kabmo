/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The CDP layer of the browser viewer, driven by a fake `WebSocket` global:
 * no socket, no browser, no network.
 *
 * Why each case is risky:
 *
 * - The protocol reader is the only thing between a malformed frame and a hung
 *   panel: a response that lands on the wrong `id` resolves the wrong promise,
 *   and an error frame that resolves instead of rejecting leaves `send()` pending.
 * - `handleClose` must reject *every* pending command and fire every close
 *   handler. A missed rejection strands an `await` and the viewer never reports
 *   `browser-offline`.
 * - The screencast scoping moved to `browser-viewer.test.ts` (both files stay
 *   under the 350-line ceiling).
 * - `connection.ts` shares one socket across viewers; a refcount bug closes it
 *   while another viewer still streams, or leaks a socket per request.
 */

import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';

import { CdpConnection } from '@/shared/lib/browser/cdp';
import { pristineWebSocket } from '@/test-support/pristine-globals';
import { acquireConnection, releaseConnection } from '@/shared/lib/browser/connection';

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
    this.answered.add(frame.id);
    const result = FakeSocket.replies.get(frame.method);
    queueMicrotask(() => this.emit('message', { data: JSON.stringify({ id: frame.id, result }) }));
  }

  // Answers the commands the canned table left pending: unanswered, each rejects
  // 15s later — after this file is over — and fails whichever suite runs then.
  drainPending(): void {
    for (const raw of this.sent) {
      const frame = JSON.parse(raw) as { id: number };
      if (this.answered.has(frame.id)) continue;
      this.answered.add(frame.id);
      this.emit('message', { data: JSON.stringify({ id: frame.id, result: {} }) });
    }
  }

  private readonly answered = new Set<number>();

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
  for (const socket of FakeSocket.instances) socket.drainPending();
  FakeSocket.instances.length = 0;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete globals[key];
    else globals[key] = nativeGlobals[key];
  }
});

async function connected(): Promise<{ conn: CdpConnection; socket: FakeSocket }> {
  const pending = CdpConnection.connect('ws://cdp-test');
  const socket = FakeSocket.instances.at(-1) as FakeSocket;
  socket.emit('open', {});
  return { conn: await pending, socket };
}

describe('CDP connect', () => {
  test('resolves once the socket opens', async () => {
    const { conn } = await connected();
    expect(conn.closed).toBe(false);
  });

  test('rejects when the socket errors before opening', async () => {
    FakeSocket.autoOpen = false;
    const pending = CdpConnection.connect('ws://cdp-error');
    FakeSocket.instances.at(-1)?.emit('error', {});
    await expect(pending).rejects.toThrow('CDP connect failed: ws://cdp-error');
  });

  test('rejects a socket that never opens', async () => {
    FakeSocket.autoOpen = false;
    jest.useFakeTimers();
    try {
      const pending = CdpConnection.connect('ws://cdp-timeout', { timeoutMs: 20 });
      jest.advanceTimersByTime(20);
      await expect(pending).rejects.toThrow('CDP connect timed out after 20ms: ws://cdp-timeout');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('CDP command framing', () => {
  test('numbers commands sequentially and always sends params', async () => {
    const { conn, socket } = await connected();
    void conn.send('Target.getTargets');
    void conn.send('Page.enable', { a: 1 });
    expect(socket.frames()).toEqual([
      { id: 1, method: 'Target.getTargets', params: {} },
      { id: 2, method: 'Page.enable', params: { a: 1 } },
    ]);
  });

  test('routes a flattened session in its own field, not in params', async () => {
    const { conn, socket } = await connected();
    void conn.send('Page.startScreencast', { format: 'jpeg' }, 'SESS-1');
    expect(socket.frames()[0]).toEqual({
      id: 1,
      method: 'Page.startScreencast',
      params: { format: 'jpeg' },
      sessionId: 'SESS-1',
    });
  });

  test('correlates responses by id, even out of order', async () => {
    const { conn, socket } = await connected();
    const first = conn.send('First');
    const second = conn.send('Second');
    socket.reply(2, { result: 'two' });
    socket.reply(1, { result: 'one' });
    expect(await second).toBe('two');
    expect(await first).toBe('one');
  });

  test('rejects with the method and the CDP error message', async () => {
    const { conn, socket } = await connected();
    const pending = conn.send('Target.attachToTarget');
    socket.reply(1, { error: { message: 'No target with given id' } });
    await expect(pending).rejects.toThrow('Target.attachToTarget: No target with given id');
  });

  test('falls back to a generic error text when CDP omits the message', async () => {
    const { conn, socket } = await connected();
    const pending = conn.send('Target.detachFromTarget');
    socket.reply(1, { error: {} });
    await expect(pending).rejects.toThrow('Target.detachFromTarget: CDP error');
  });

  test('times out a command the browser never answers', async () => {
    FakeSocket.autoOpen = false;
    jest.useFakeTimers();
    try {
      const pending = CdpConnection.connect('ws://cdp-slow', { timeoutMs: 20 });
      FakeSocket.instances.at(-1)?.emit('open', {});
      const conn = await pending;
      const command = conn.send('Never.answered');
      jest.advanceTimersByTime(20);
      await expect(command).rejects.toThrow('CDP command timed out after 20ms: Never.answered');
    } finally {
      jest.useRealTimers();
    }
  });

  test('ignores unknown ids, non-string data, bad JSON and non-object frames', async () => {
    const { conn, socket } = await connected();
    const pending = conn.send('Still.alive');
    socket.reply(99, { result: 'nobody' });
    socket.emit('message', { data: 42 });
    socket.emit('message', { data: 'not json' });
    socket.emit('message', { data: '["array"]' });
    socket.emit('message', { data: JSON.stringify({ method: 7 }) });
    socket.emit('message', { data: JSON.stringify({ method: 'Event.with.odd.params' }) });
    socket.reply(1, { result: 'ok' });
    expect(await pending).toBe('ok');
  });
});

describe('CDP events and close', () => {
  test('fans out method, params and session id', async () => {
    const { conn, socket } = await connected();
    const seen: unknown[] = [];
    conn.onEvent((method, params, sessionId) => seen.push([method, params, sessionId]));
    socket.emit('message', { data: JSON.stringify({ method: 'Page.screencastFrame', params: { data: 'x' }, sessionId: 'S1' }) });
    expect(seen).toEqual([['Page.screencastFrame', { data: 'x' }, 'S1']]);
  });

  test('a throwing subscriber never kills the reader or its peers', async () => {
    const { conn, socket } = await connected();
    const seen: string[] = [];
    conn.onEvent(() => {
      throw new Error('subscriber bug');
    });
    conn.onEvent((method) => seen.push(method));
    socket.emit('message', { data: JSON.stringify({ method: 'Target.targetCreated', params: {} }) });
    expect(seen).toEqual(['Target.targetCreated']);
  });

  test('unsubscribing stops delivery', async () => {
    const { conn, socket } = await connected();
    const seen: string[] = [];
    const off = conn.onEvent((method) => seen.push(method));
    off();
    socket.emit('message', { data: JSON.stringify({ method: 'Page.frameNavigated', params: {} }) });
    expect(seen).toEqual([]);
  });

  test('closing rejects every pending command with one shared error', async () => {
    const { conn } = await connected();
    const first = conn.send('A');
    const second = conn.send('B');
    conn.close();
    await expect(first).rejects.toThrow('CDP connection closed');
    await expect(second).rejects.toThrow('CDP connection closed');
    expect(conn.closed).toBe(true);
  });

  test('rejects new commands once closed', async () => {
    const { conn } = await connected();
    conn.close();
    await expect(conn.send('A')).rejects.toThrow('CDP connection is closed');
  });

  test('runs close handlers once, and only while open', async () => {
    const { conn } = await connected();
    let calls = 0;
    conn.onClose(() => {
      calls += 1;
    });
    conn.close();
    conn.close();
    expect(calls).toBe(1);
    let late = 0;
    conn.onClose(() => {
      late += 1;
    });
    expect(late).toBe(0);
  });

  test('a remote close also fails pending commands', async () => {
    const { conn, socket } = await connected();
    const pending = conn.send('A');
    socket.emit('close', {});
    await expect(pending).rejects.toThrow('CDP connection closed');
    expect(conn.closed).toBe(true);
  });
});

describe('shared connection pool', () => {
  test('shares one socket and closes it on the last release', async () => {
    const first = await acquireConnection('ws://pool-share');
    const second = await acquireConnection('ws://pool-share');
    expect(second).toBe(first);
    expect(FakeSocket.instances.length).toBe(1);
    releaseConnection('ws://pool-share', first);
    expect(FakeSocket.instances[0].closed).toBe(false);
    releaseConnection('ws://pool-share', second);
    expect(FakeSocket.instances[0].closed).toBe(true);
  });

  test('single-flights concurrent acquires onto one socket', async () => {
    const [first, second] = await Promise.all([acquireConnection('ws://pool-race'), acquireConnection('ws://pool-race')]);
    expect(first).toBe(second);
    expect(FakeSocket.instances.length).toBe(1);
    releaseConnection('ws://pool-race', first);
    releaseConnection('ws://pool-race', second);
  });

  test('opens a fresh socket after the shared one died', async () => {
    const first = await acquireConnection('ws://pool-dead');
    FakeSocket.instances[0].emit('close', {});
    const second = await acquireConnection('ws://pool-dead');
    expect(second).not.toBe(first);
    expect(FakeSocket.instances.length).toBe(2);
    releaseConnection('ws://pool-dead', second);
  });
});
