/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two root-level server plumbing modules every streaming and API route
 * depends on.
 *
 * `sse.ts` fixes the wire format six endpoints hand-rolled: a wrong frame shape
 * (missing blank line, `data:` instead of `event:`) breaks every client at once,
 * and the coalescer's "control frames are never dropped" rule is what keeps an
 * ordered transcript. `route-adapter.ts` fixes the Remix-shaped mount contract:
 * exactly which verbs a module's exports produce, and that an action-only route
 * answers GET with 405 rather than 404 (the route exists, the verb does not).
 * Both are exercised here without a socket, a network read, or a real clock —
 * heartbeat and coalescing delays run on `vi` fake timers.
 */

import { afterEach, describe, expect, test, vi } from 'bun:test';

import { createEventCoalescer, createSseStream } from '@/server/lib/sse';
import {
  actionBindings,
  adaptHandler,
  bindingsFor,
  errorResponse,
  methodNotAllowed,
  parseJsonBody,
  requireParam,
  type HandlerBinding,
  type RouteHandler,
} from '@/server/lib/route-adapter';

/** Drain a closed SSE stream into the exact bytes a client would receive. */
async function readAll(body: ReadableStream<Uint8Array> | null): Promise<string> {
  const reader = body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

const methods = (bindings: HandlerBinding[]): string[] => bindings.map((b) => b.method);

afterEach(() => {
  vi.useRealTimers();
});

describe('createSseStream — wire format', () => {
  test('an event frame is `event: <name>\\ndata: <json>\\n\\n`', async () => {
    const sse = createSseStream();
    sse.send('message', { text: 'hi' });
    sse.close();
    expect(await readAll(sse.response.body)).toBe('event: message\ndata: {"text":"hi"}\n\n');
  });

  test('an empty event name writes a data-only frame', async () => {
    const sse = createSseStream();
    sse.send('', { a: 1 });
    sse.close();
    expect(await readAll(sse.response.body)).toBe('data: {"a":1}\n\n');
  });

  test('the response is an uncompressed event stream with caller headers merged', () => {
    const sse = createSseStream({ headers: { 'cache-control': 'no-store', 'x-extra': '1' } });
    expect(sse.response.headers.get('content-type')).toBe('text/event-stream');
    // The defaults and the caller's override are combined, not replaced: a
    // lower-cased duplicate key in the options object appends to `Cache-Control`.
    expect(sse.response.headers.get('cache-control')).toBe('no-cache, no-store');
    expect(sse.response.headers.get('connection')).toBe('keep-alive');
    expect(sse.response.headers.get('x-extra')).toBe('1');
    sse.close();
  });

  test('frames sent after close are dropped, and close is idempotent', async () => {
    const sse = createSseStream();
    sse.send('a', 1);
    sse.close();
    sse.send('b', 2);
    sse.close();
    expect(sse.isClosed()).toBe(true);
    expect(await readAll(sse.response.body)).toBe('event: a\ndata: 1\n\n');
  });

  test('isBackpressured turns true only once the unconsumed queue is over its mark', () => {
    const sse = createSseStream();
    expect(sse.isBackpressured()).toBe(false);
    for (let i = 0; i < 5; i += 1) sse.send('tick', i);
    expect(sse.isBackpressured()).toBe(true);
    sse.close();
  });

  test('a heartbeat emits one comment frame per interval until closed', async () => {
    vi.useFakeTimers();
    const sse = createSseStream({ heartbeatMs: 10 });
    vi.advanceTimersByTime(30);
    sse.close();
    expect(await readAll(sse.response.body)).toBe(':\n\n:\n\n:\n\n');
  });

  test('beforeHeartbeat returning false suppresses every beat', async () => {
    vi.useFakeTimers();
    const sse = createSseStream({ heartbeatMs: 10, beforeHeartbeat: () => false });
    vi.advanceTimersByTime(50);
    sse.close();
    expect(await readAll(sse.response.body)).toBe('');
  });

  test('aborting tears the stream down and runs the onStart cleanup exactly once', async () => {
    const controller = new AbortController();
    let cleanups = 0;
    const sse = createSseStream({
      signal: controller.signal,
      onStart: () => () => {
        cleanups += 1;
      },
    });
    controller.abort();
    expect(sse.isClosed()).toBe(true);
    // `start` is async: the abort lands while it is still awaiting `onStart`,
    // so the cleanup it stored runs on the next microtask.
    await Promise.resolve();
    expect(cleanups).toBe(1);
    controller.abort();
    expect(cleanups).toBe(1);
  });

  test('an already-aborted signal closes the stream without running onStart', () => {
    const controller = new AbortController();
    controller.abort();
    let started = false;
    const sse = createSseStream({ signal: controller.signal, onStart: () => void (started = true) });
    expect(sse.isClosed()).toBe(true);
    expect(started).toBe(false);
  });
});

describe('createEventCoalescer', () => {
  test('a control frame is sent immediately even while backpressured', () => {
    const sent: Array<[string, unknown]> = [];
    const coalescer = createEventCoalescer({
      send: (event, data) => void sent.push([event, data]),
      isBackpressured: () => true,
      flushDelayMs: 50,
    });
    coalescer.push('control', { type: 'ready' });
    expect(sent).toEqual([['control', { type: 'ready' }]]);
  });

  test('replaceable message_update frames coalesce to the latest and flush before a control frame', () => {
    const sent: Array<[string, unknown]> = [];
    const coalescer = createEventCoalescer({
      send: (event, data) => void sent.push([event, data]),
      isBackpressured: () => true,
      flushDelayMs: 50,
    });
    coalescer.push('message', { type: 'message_update', n: 1 });
    coalescer.push('message', { type: 'message_update', n: 2 });
    expect(sent).toEqual([]);
    coalescer.push('control', { type: 'done' });
    expect(sent).toEqual([
      ['message', { type: 'message_update', n: 2 }],
      ['control', { type: 'done' }],
    ]);
  });

  test('a message_update is sent immediately when not backpressured', () => {
    const sent: Array<[string, unknown]> = [];
    const coalescer = createEventCoalescer({
      send: (event, data) => void sent.push([event, data]),
      isBackpressured: () => false,
      flushDelayMs: 50,
    });
    coalescer.push('message', { type: 'message_update', n: 1 });
    expect(sent).toHaveLength(1);
  });

  test('a pending frame is flushed after the delay even without a control frame', () => {
    vi.useFakeTimers();
    const sent: Array<[string, unknown]> = [];
    const coalescer = createEventCoalescer({
      send: (event, data) => void sent.push([event, data]),
      isBackpressured: () => true,
      flushDelayMs: 10,
    });
    coalescer.push('message', { type: 'message_update', n: 1 });
    vi.advanceTimersByTime(10);
    expect(sent).toEqual([['message', { type: 'message_update', n: 1 }]]);
  });

  test('dispose drops the pending frame and ignores later pushes', () => {
    vi.useFakeTimers();
    const sent: Array<[string, unknown]> = [];
    const coalescer = createEventCoalescer({
      send: (event, data) => void sent.push([event, data]),
      isBackpressured: () => true,
      flushDelayMs: 10,
    });
    coalescer.push('message', { type: 'message_update', n: 1 });
    coalescer.dispose();
    vi.advanceTimersByTime(30);
    coalescer.push('control', { type: 'done' });
    expect(sent).toEqual([]);
  });
});

describe('bindingsFor — the mount contract', () => {
  test('a loader-only module mounts GET only', () => {
    const loader: RouteHandler = () => 'ok';
    const bindings = bindingsFor({ loader }, '/x');
    expect(methods(bindings)).toEqual(['GET']);
    expect(bindings[0]!.handler).toBe(loader);
  });

  test('an action-only module mounts four mutating verbs plus a 405 GET fallback', () => {
    const action: RouteHandler = () => 'ok';
    const bindings = bindingsFor({ action }, '/x');
    expect(methods(bindings)).toEqual(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
    expect(bindings[0]!.handler).toBe(methodNotAllowed);
    expect(bindings.slice(1).every((b) => b.handler === action)).toBe(true);
  });

  test('a module exporting both mounts the loader on GET and the action on the rest', () => {
    const loader: RouteHandler = () => 1;
    const action: RouteHandler = () => 2;
    const bindings = bindingsFor({ loader, action }, '/x');
    expect(methods(bindings)).toEqual(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
    expect(bindings[0]!.handler).toBe(loader);
    expect(bindings.slice(1).every((b) => b.handler === action)).toBe(true);
  });

  test('the mutating set can be narrowed', () => {
    const bindings = bindingsFor({ action: () => 'ok' }, '/x', { mutating: ['PATCH'] });
    expect(methods(bindings)).toEqual(['GET', 'PATCH']);
  });

  test('an empty module mounts nothing, and every binding carries the path', () => {
    expect(bindingsFor({}, '/x')).toEqual([]);
    expect(bindingsFor({ loader: () => 'ok' }, '/y').every((b) => b.path === '/y')).toBe(true);
  });
});

describe('methodNotAllowed', () => {
  test('is a 405 JSON envelope, not a 404', async () => {
    const res = (await methodNotAllowed({ request: new Request('http://test/'), params: {} })) as Response;
    expect(res.status).toBe(405);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await res.json()).toEqual({ error: 'Method not allowed' });
  });
});

describe('actionBindings', () => {
  test('defaults to the four mutating verbs plus a 405 GET fallback', () => {
    const action: RouteHandler = () => 'ok';
    const bindings = actionBindings(action, '/x');
    expect(methods(bindings)).toEqual(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
    expect(bindings[0]!.handler).toBe(methodNotAllowed);
    expect(bindings.slice(1).every((b) => b.handler === action)).toBe(true);
  });

  test('a provided GET handler replaces the fallback', () => {
    const get: RouteHandler = () => 'list';
    const bindings = actionBindings(() => 'ok', '/x', get);
    expect(bindings[0]!.handler).toBe(get);
  });
});

describe('adaptHandler', () => {
  const invoke = (handler: RouteHandler, method = 'POST'): Promise<Response> =>
    adaptHandler(handler)({ request: new Request('http://test/x', { method }), params: {} });

  test('a plain object becomes a JSON 200', async () => {
    const res: Response = await invoke(() => ({ ok: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test('a thrown error becomes a 500 JSON envelope', async () => {
    const res: Response = await invoke(() => {
      throw new Error('boom');
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'boom' });
  });

  test("an action's own 405 Response is passed through unchanged", async () => {
    const res: Response = await invoke(() => new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 }));
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error: 'Method not allowed' });
  });
});

describe('parseJsonBody / requireParam / errorResponse', () => {
  test('parses a JSON request body', async () => {
    const request = new Request('http://test/x', { method: 'POST', body: '{"a":1}' });
    expect(await parseJsonBody(request)).toEqual({ ok: true, body: { a: 1 } });
  });

  test('a malformed body reports ok:false instead of throwing', async () => {
    const result = await parseJsonBody(new Request('http://test/x', { method: 'POST', body: 'not json' }));
    expect(result.ok).toBe(false);
  });

  test('requireParam returns the value or null for absent/empty', () => {
    expect(requireParam({ id: '7' }, 'id')).toBe('7');
    expect(requireParam({ id: '' }, 'id')).toBeNull();
    expect(requireParam({}, 'id')).toBeNull();
  });

  test('errorResponse wraps the message with the requested status', async () => {
    const res = errorResponse(new Error('nope'), 422);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'nope' });
    expect(errorResponse('plain').status).toBe(500);
    expect(await errorResponse('plain').json()).toEqual({ error: 'plain' });
  });
});
