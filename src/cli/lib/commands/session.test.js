/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The CLI is a thin client: these cases prove it sends the right path, body and
 * bearer token, not that the server handles them (route tests own that).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { run } from './session.js';

let server;
let captured;
let waitCalls;
let savedUrl;
let savedToken;

beforeEach(() => {
  captured = [];
  waitCalls = 0;
  savedUrl = Bun.env.KABMO_SERVER_URL;
  savedToken = Bun.env.KABMO_AGENT_TOKEN;
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = request.method === 'POST' ? await request.json().catch(() => null) : null;
      captured.push({
        url: new URL(request.url).pathname,
        method: request.method,
        authorization: request.headers.get('authorization'),
        body,
      });
      if (request.url.endsWith('/api/agent/w')) {
        waitCalls += 1;
        return Response.json({ running: waitCalls < 2 });
      }
      if (request.url.includes('/fork')) {
        return Response.json({ sessionId: 'child', sourceSessionId: 'root', originKind: 'fork' });
      }
      if (request.url.endsWith('/api/sessions/spawn')) {
        return Response.json({ sessionId: 'child', harness: 'omp-rpc', parentSessionId: 'root', depth: 1 });
      }
      return Response.json({ ok: true });
    },
  });
  Bun.env.KABMO_SERVER_URL = `http://127.0.0.1:${server.port}`;
  Bun.env.KABMO_AGENT_TOKEN = 'agent-token';
});

afterEach(() => {
  server.stop(true);
  if (savedUrl === undefined) delete Bun.env.KABMO_SERVER_URL;
  else Bun.env.KABMO_SERVER_URL = savedUrl;
  if (savedToken === undefined) delete Bun.env.KABMO_AGENT_TOKEN;
  else Bun.env.KABMO_AGENT_TOKEN = savedToken;
});

describe('kabmo session', () => {
  test('spawn sends parentSelf and the token', async () => {
    await run({ args: ['spawn'], prompt: 'review this', 'parent-self': true, harness: 'codex', json: true });
    expect(captured).toEqual([
      {
        url: '/api/sessions/spawn',
        method: 'POST',
        authorization: 'Bearer agent-token',
        body: { prompt: 'review this', parentSelf: true, harness: 'codex' },
      },
    ]);
  });

  test('fork sends the anchor and no empty prompt', async () => {
    await run({ args: ['fork', 'root'], 'anchor-entry': 'a1', json: true });
    expect(captured[0]).toMatchObject({
      url: '/api/sessions/root/fork',
      method: 'POST',
      body: { anchorEntryId: 'a1' },
    });
  });

  test('tell posts the prompt command to the agent route', async () => {
    await run({ args: ['tell', 'child'], message: 'hello', json: true });
    expect(captured[0]).toMatchObject({
      url: '/api/agent/child',
      method: 'POST',
      body: { type: 'prompt', message: 'hello' },
    });
  });

  test('wait polls until the session is idle', async () => {
    const savedInterval = Bun.env.KABMO_WAIT_INTERVAL_MS;
    Bun.env.KABMO_WAIT_INTERVAL_MS = '1';
    try {
      await run({ args: ['wait', 'w'], timeout: 5, json: true });
    } finally {
      if (savedInterval === undefined) delete Bun.env.KABMO_WAIT_INTERVAL_MS;
      else Bun.env.KABMO_WAIT_INTERVAL_MS = savedInterval;
    }
    expect(waitCalls).toBe(2);
    expect(captured.map((entry) => entry.url)).toEqual(['/api/agent/w', '/api/agent/w']);
  });
});
