/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/** The screencast viewer half of `browser-cdp.test.ts`: tab ownership and
 * attach scoping for `openScreencast`. Split verbatim so both files stay
 * under the repo's 350-line ceiling; the shared CDP fakes ride along because
 * the file must stand alone. */

import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';

import { acquireConnection, releaseConnection } from '@/shared/lib/browser/connection';
import { pristineWebSocket } from '@/test-support/pristine-globals';
import { openScreencast, type ScreencastHandle } from '@/shared/lib/browser/viewer';
import type { BrowserActionDraft } from '@/shared/lib/browser/activity';
import type { BrowserViewFrame, BrowserViewState } from '@/shared/types';

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

  /**
   * Answer every command the canned table left unanswered.
   *
   * A command with no reply stays in the client's pending map until its 15s
   * timeout and then rejects — long after this file's tests are over, so the
   * unhandled rejection is reported under whichever suite runs next and fails
   * it. The fire-and-forget commands this file exercises are drained here
   * instead, once the assertions that needed them pending have already run.
   */
  drainPending(): void {
    for (const raw of this.sent) {
      const frame = JSON.parse(raw) as { id: number };
      if (this.answered.has(frame.id)) continue;
      this.answered.add(frame.id);
      this.emit('message', { data: JSON.stringify({ id: frame.id, result: {} }) });
    }
  }

  /** Ids this socket has already answered. */
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


describe('screencast viewer', () => {
  const PAGES = {
    targetInfos: [
      { targetId: 'other-1', type: 'page', url: 'https://other.test', title: 'Other' },
      { targetId: 'mine-1', type: 'page', url: 'https://mine.test', title: 'Mine' },
      { targetId: 'mine-2', type: 'page', url: 'https://mine2.test', title: 'Mine2' },
    ],
  };

  interface Recorder {
    frames: BrowserViewFrame[];
    states: BrowserViewState[];
    actions: BrowserActionDraft[];
  }

  async function open(owned: string[] = ['mine-1', 'mine-2']): Promise<{ handle: ScreencastHandle; socket: FakeSocket; seen: Recorder }> {
    FakeSocket.replies.set('Target.setDiscoverTargets', {});
    FakeSocket.replies.set('Target.getTargets', PAGES);
    FakeSocket.replies.set('Target.attachToTarget', { sessionId: 'SESS-1' });
    FakeSocket.replies.set('Page.addScriptToEvaluateOnNewDocument', { identifier: 'script-1' });
    for (const method of ['Runtime.enable', 'Runtime.addBinding', 'Page.enable', 'Runtime.evaluate', 'Page.startScreencast']) {
      FakeSocket.replies.set(method, {});
    }
    // The fake socket only answers methods it has a canned reply for, and
    // `detach()` awaits `Page.stopScreencast` before it can send
    // `Target.detachFromTarget` — an unanswered first command leaves the
    // second one stuck on the command timeout.
    for (const method of ['Page.stopScreencast', 'Target.detachFromTarget']) {
      FakeSocket.replies.set(method, {});
    }
    const seen: Recorder = { frames: [], states: [], actions: [] };
    const handle = await openScreencast('ws://viewer-test', {
      getOwnedTargetIds: async () => owned,
      onFrame: (frame) => seen.frames.push(frame),
      onState: (state) => seen.states.push(state),
      onAction: (action) => seen.actions.push(action),
    });
    return { handle, socket: FakeSocket.instances.at(-1) as FakeSocket, seen };
  }

  test('attaches to the newest owned tab, never another session page', async () => {
    const { handle, socket } = await open();
    const attach = socket.frames().find((frame) => frame.method === 'Target.attachToTarget');
    expect(attach?.params).toEqual({ targetId: 'mine-2', flatten: true });
    handle.close();
  });

  test('reports live state scoped to owned tabs only', async () => {
    const { handle, seen } = await open();
    expect(seen.states[0]).toEqual({
      status: 'live',
      url: 'https://mine2.test',
      title: 'Mine2',
      targetId: 'mine-2',
      tabs: [
        { targetId: 'mine-1', url: 'https://mine.test', title: 'Mine' },
        { targetId: 'mine-2', url: 'https://mine2.test', title: 'Mine2' },
      ],
    });
    handle.close();
  });

  test('reports no-tab instead of attaching when nothing is owned', async () => {
    const { handle, socket, seen } = await open([]);
    expect(seen.states).toEqual([{ status: 'no-tab', tabs: [] }]);
    expect(socket.frames().some((frame) => frame.method === 'Target.attachToTarget')).toBe(false);
    handle.close();
  });

  test('starts the screencast with the viewer frame params', async () => {
    const { handle, socket } = await open();
    const start = socket.frames().find((frame) => frame.method === 'Page.startScreencast');
    // Every frame at 1 600 px was the panel's old ask; the frame rate is a real
    // memory lever (see `SCREENCAST_PARAMS`), so it is pinned here rather than
    // left to drift back to `everyNthFrame: 1`.
    expect(start?.params).toEqual({ format: 'jpeg', quality: 60, maxWidth: 1280, maxHeight: 800, everyNthFrame: 2 });
    expect(start?.sessionId).toBe('SESS-1');
    handle.close();
  });

  test('assembles a frame and acks the browser frame id', async () => {
    const { handle, socket, seen } = await open();
    socket.emit('message', {
      data: JSON.stringify({ method: 'Page.screencastFrame', params: { data: 'JPEG', sessionId: 7 }, sessionId: 'SESS-1' }),
    });
    expect(seen.frames).toEqual([{ data: 'JPEG', mimeType: 'image/jpeg', targetId: 'mine-2' }]);
    const ack = socket.frames().find((frame) => frame.method === 'Page.screencastFrameAck');
    expect(ack?.params).toEqual({ sessionId: 7 });
    handle.close();
  });

  test('drops frames from a session it does not own', async () => {
    const { handle, socket, seen } = await open();
    socket.emit('message', {
      data: JSON.stringify({ method: 'Page.screencastFrame', params: { data: 'LEAK' }, sessionId: 'SESS-OTHER' }),
    });
    expect(seen.frames).toEqual([]);
    handle.close();
  });

  test('reports a top-level navigation and ignores about:blank and subframes', async () => {
    const { handle, socket, seen } = await open();
    const navigate = (frame: Record<string, unknown>) =>
      socket.emit('message', { data: JSON.stringify({ method: 'Page.frameNavigated', params: { frame }, sessionId: 'SESS-1' }) });
    navigate({ url: 'about:blank' });
    navigate({ url: 'https://nav.test/x', parentId: 'parent' });
    navigate({ url: 'https://nav.test/x' });
    expect(seen.actions).toEqual([{ kind: 'loaded', label: 'Halaman dimuat: nav.test/x' }]);
    handle.close();
  });

  test('accepts observer payloads only from the current session and binding', async () => {
    const { handle, socket, seen } = await open();
    const binding = (payload: unknown, sessionId: string, name = '__kabmoAction') =>
      socket.emit('message', { data: JSON.stringify({ method: 'Runtime.bindingCalled', params: { name, payload }, sessionId }) });
    binding(JSON.stringify({ kind: 'click', label: 'Mengklik tombol' }), 'SESS-OTHER');
    binding(JSON.stringify({ kind: 'click', label: 'Mengklik tombol' }), 'SESS-1', 'otherBinding');
    binding(JSON.stringify({ kind: 'click', label: 'Mengklik tombol' }), 'SESS-1');
    expect(seen.actions).toEqual([{ kind: 'click', label: 'Mengklik tombol' }]);
    handle.close();
  });

  test('close detaches the flattened session while the socket is still shared', async () => {
    // A second reference keeps the pooled socket open, which is the case where
    // `Target.detachFromTarget` must actually be sent: it is browser-level, so
    // the session id belongs in params, not the routing field, or the
    // attached session silently leaks for the remaining viewer.
    // The holder is taken BEFORE `open()`: the viewer acquires the pooled
    // connection by ref count, and grabbing it afterwards would race the
    // viewer's own open.
    //
    // `close()` fires `detach()` as fire-and-forget, and the second command
    // only goes out once the first one's reply lands — so the fake clock is
    // stepped instead of waiting on microtasks alone.
    const holder = await acquireConnection('ws://viewer-test');
    const { handle, socket } = await open();
    jest.useFakeTimers();
    try {
      handle.close();
      await runTimers(6, 1000);
    } finally {
      jest.useRealTimers();
    }
    expect(socket.frames().map((frame) => frame.method)).toContain('Page.stopScreencast');
    const detach = socket.frames().find((frame) => frame.method === 'Target.detachFromTarget');
    expect(detach?.params).toEqual({ sessionId: 'SESS-1' });
    expect(detach?.sessionId).toBeUndefined();
    expect(socket.closed).toBe(false);
    releaseConnection('ws://viewer-test', holder);
    expect(socket.closed).toBe(true);
  });

  test('the last close releases the socket and is idempotent', async () => {
    const { handle, socket } = await open();
    handle.close();
    handle.close();
    await flush();
    expect(socket.frames().map((frame) => frame.method)).toContain('Page.stopScreencast');
    expect(socket.closed).toBe(true);
  });
});
