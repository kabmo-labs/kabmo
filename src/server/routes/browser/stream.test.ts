/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The SSE contract of `GET /api/browser/:sessionId/stream`.
 *
 * This is the browser-panel transport: the route answers with a long-lived
 * `text/event-stream` rather than a JSON body, and it deliberately does NOT
 * error when the agent, the shared browser, or a tab is missing — each of those
 * can appear later in the session's life, so the stream reports a coarse state
 * and keeps polling. The two states reachable without a real Chromium are the
 * ones pinned here: `browser-offline` under MOCK, and `agent-offline` for a
 * session this process does not run. The stream must also be cancellable —
 * a client disconnect has to clear the 1s poll timer, or the test process (and
 * the server) would keep a timer alive for every abandoned panel.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { loader } from '@/server/routes/browser/stream';

const originalMock = Bun.env.MOCK;
const UNKNOWN_SESSION = 'stream-test-unknown-session';

beforeEach(() => {
  delete Bun.env.MOCK;
});

afterEach(() => {
  if (originalMock === undefined) delete Bun.env.MOCK;
  else Bun.env.MOCK = originalMock;
});

afterAll(() => {
  delete Bun.env.MOCK;
});

function requestFor(sessionId: string, target?: string): Request {
  const url = new URL(`http://localhost/api/browser/${sessionId}/stream`);
  if (target !== undefined) url.searchParams.set('target', target);
  return new Request(url);
}

/**
 * Read exactly one SSE frame from the stream, then cancel it so the route's
 * poll timer and heartbeat are torn down with it.
 */
async function firstFrame(res: Response): Promise<{ frame: string; text: string }> {
  const reader = res.body!.getReader();
  const { value } = await reader.read();
  const text = new TextDecoder().decode(value);
  await reader.cancel();
  const end = text.indexOf('\n\n');
  return { frame: text.slice(0, end === -1 ? text.length : end + 2), text };
}

describe('browser stream framing', () => {
  test('answers a cancellable SSE response with its own cache policy', async () => {
    const res = (await loader({ params: { sessionId: UNKNOWN_SESSION }, request: requestFor(UNKNOWN_SESSION) } as never)) as Response;
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    // Overrides the shared default: a proxy must not transform or buffer frames.
    expect(res.headers.get('cache-control')).toBe('no-cache, no-transform');
    await res.body!.cancel();
  });

  test('MOCK mode reports the browser offline instead of touching a daemon', async () => {
    Bun.env.MOCK = '1';
    const res = (await loader({ params: { sessionId: UNKNOWN_SESSION }, request: requestFor(UNKNOWN_SESSION) } as never)) as Response;
    const { frame } = await firstFrame(res);
    expect(frame).toBe('event: state\ndata: {"status":"browser-offline","tabs":[]}\n\n');
  });

  test('a session this process does not run reports the agent offline', async () => {
    const res = (await loader({ params: { sessionId: UNKNOWN_SESSION }, request: requestFor(UNKNOWN_SESSION) } as never)) as Response;
    const { frame } = await firstFrame(res);
    expect(frame).toBe('event: state\ndata: {"status":"agent-offline","tabs":[]}\n\n');
  });

  test('an absent sessionId is treated as an unknown session, not a crash', async () => {
    const res = (await loader({ params: {}, request: requestFor('x') } as never)) as Response;
    const { frame } = await firstFrame(res);
    expect(frame).toContain('"status":"agent-offline"');
  });

  test('the target query parameter is accepted without changing the framing', async () => {
    const res = (await loader({
      params: { sessionId: UNKNOWN_SESSION },
      request: requestFor(UNKNOWN_SESSION, 'target-42'),
    } as never)) as Response;
    expect(res.status).toBe(200);
    const { frame } = await firstFrame(res);
    expect(frame).toContain('"status":"agent-offline"');
  });

  test('cancelling the stream closes it and stops the poll timer', async () => {
    const res = (await loader({ params: { sessionId: UNKNOWN_SESSION }, request: requestFor(UNKNOWN_SESSION) } as never)) as Response;
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    // The cancel tears the stream down, so the poll interval and heartbeat are
    // cleared with it and the next read is already done.
    expect((await reader.read()).done).toBe(true);
  });
});
