/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Peer forwarding: relaying a command to the instance that owns a session.
 *
 * The load-bearing rules:
 *   - a relayed request carries the hop header, and a request that already has
 *     it is never relayed again (two instances that disagree about ownership
 *     must not bounce a request forever);
 *   - the method, path and query travel unchanged, and a body the caller has
 *     already parsed is re-serialized rather than re-read (the body can only be
 *     consumed once);
 *   - an unreachable peer answers 502 with a code, never a thrown error, so the
 *     route can fall back to the ownership refusal.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { forwardToPeer, isPeerRelayed, PEER_HOP_HEADER, peerRealtimeSocketUrl } from '@/server/lib/omp/rpc/peer-proxy.server';

let originalFetch: typeof globalThis.fetch;
let captured: { url: string; init: RequestInit } | null;

beforeEach(() => {
  captured = null;
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stubFetch(responder: (url: string, init: RequestInit) => Response | Promise<Response>): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    captured = { url, init: init ?? {} };
    return responder(url, init ?? {});
  }) as typeof globalThis.fetch;
}

describe('isPeerRelayed', () => {
  test('a request carrying the hop header has already been relayed', () => {
    const relayed = new Request('http://127.0.0.1:3001/api/agent/s1', { headers: { [PEER_HOP_HEADER]: '1' } });
    expect(isPeerRelayed(relayed)).toBe(true);
  });

  test('a fresh request has not', () => {
    expect(isPeerRelayed(new Request('http://127.0.0.1:3001/api/agent/s1'))).toBe(false);
  });
});

describe('forwardToPeer', () => {
  test('preserves method, path and query, and adds the hop header', async () => {
    stubFetch(() => Response.json({ success: true }));
    const request = new Request('http://127.0.0.1:3001/api/agent/s1?x=1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'prompt', message: 'hi' }),
    });
    const response = await forwardToPeer(request, 'http://127.0.0.1:3195', { type: 'prompt', message: 'hi' });
    expect(captured?.url).toBe('http://127.0.0.1:3195/api/agent/s1?x=1');
    expect(captured?.init.method).toBe('POST');
    expect((captured?.init.headers as Headers).get(PEER_HOP_HEADER)).toBe('1');
    // The caller's parsed body is what travels, not a re-read of the request.
    expect(captured?.init.body).toBe(JSON.stringify({ type: 'prompt', message: 'hi' }));
    expect(await response.json()).toEqual({ success: true });
  });

  test('a GET relays no body', async () => {
    stubFetch(() => Response.json({ running: true }));
    await forwardToPeer(new Request('http://127.0.0.1:3001/api/agent/s1'), 'http://127.0.0.1:3195');
    expect(captured?.init.method).toBe('GET');
    expect(captured?.init.body).toBeUndefined();
  });

  test('an unreachable peer answers 502 with a code, never throws', async () => {
    stubFetch(() => {
      throw new Error('connect ECONNREFUSED');
    });
    const response = await forwardToPeer(new Request('http://127.0.0.1:3001/api/agent/s1'), 'http://127.0.0.1:3195');
    expect(response.status).toBe(502);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe('peer_unreachable');
  });

  test("the peer's own error status is passed through unchanged", async () => {
    stubFetch(() => Response.json({ error: 'nope' }, { status: 409 }));
    const response = await forwardToPeer(new Request('http://127.0.0.1:3001/api/agent/s1'), 'http://127.0.0.1:3195');
    expect(response.status).toBe(409);
  });
});

describe('peerRealtimeSocketUrl', () => {
  test('points at the owner unified socket, and carries no session id', () => {
    // The relay subscribes the session topic ON that socket. The per-session
    // `/api/agent/<id>/ws` path it used to build was deleted with the realtime
    // migration, so this pins the path a route actually answers.
    expect(peerRealtimeSocketUrl('http://127.0.0.1:3195')).toBe('ws://127.0.0.1:3195/api/realtime/ws');
  });

  test('rewrites https to wss', () => {
    expect(peerRealtimeSocketUrl('https://127.0.0.1:3195')).toBe('wss://127.0.0.1:3195/api/realtime/ws');
  });
});
