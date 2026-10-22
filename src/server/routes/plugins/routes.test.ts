/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The plugin PLATFORM routes: `GET /api/plugins` and the RPC + HTTP families.
 *
 * What this suite exists for is the boundary between a URL and a plugin's own
 * code, and each rule is one a wrong answer makes invisible:
 *
 * - **A plugin id is validated before anything resolves.** It reaches a map
 *   lookup and it names a path, so a traversal segment must be refused at the
 *   door rather than looked up in a namespace a caller chose.
 * - **An unknown method is 404; a plugin that SAID NO is 200.** A method's
 *   failure is a value (`{ ok: false, error }`) because the call itself
 *   succeeded — only a malformed request is a 4xx. Collapsing the two would
 *   make a plugin's own refusal look like a broken server.
 * - **A bad argument is `invalid_input` with the schema's issues**, not a 500
 *   and not a silent pass-through to the handler.
 * - **A body that is not JSON is refused before it is parsed**, and a body over
 *   the limit is refused before it is read.
 * - **An HTTP route matches EXACTLY**, so `/notes/detail` is not served by a
 *   `/notes` registration.
 *
 * Exercised against the route handlers directly, because the registration is
 * in-process state: a live HTTP probe would need a server boot per case for a
 * decision that is a map hit.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { action as rpcAction, loader as rpcLoader } from '@/server/routes/plugins/rpc';
import { loader as stateLoader } from '@/server/routes/plugins/state';
import { action as httpAction } from '@/server/routes/plugins/http';
import { registerRpcMethod, resetPluginRpc } from '@/server/lib/plugins/rpc.server';
import { createPluginHttp, resetPluginHttp } from '@/server/lib/plugins/http.server';

beforeAll(async () => {
  await isolateDb();
});

afterAll(async () => {
  await releaseDb();
});

afterEach(() => {
  resetPluginRpc();
  resetPluginHttp();
});

const PLUGIN = 'demo';

/**
 * A POST carrying `body` as JSON. `RAW` marks a body sent VERBATIM, which is
 * how the malformed-JSON case is expressed — a plain string argument is itself
 * a legal JSON value, so overloading it would make `'ok'` un-sendable.
 */
const RAW = Symbol('raw-body');

function rpcRequest(method: string, body: unknown, pluginId = PLUGIN): Request {
  const payload =
    typeof body === 'object' && body !== null && RAW in body
      ? String((body as { [RAW]: unknown })[RAW])
      : JSON.stringify(body ?? null);
  return new Request(`http://localhost/api/plugins/${pluginId}/rpc/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: payload,
  });
}

async function callRpc(method: string, body: unknown, pluginId = PLUGIN) {
  const response = (await rpcAction({
    request: rpcRequest(method, body, pluginId),
    params: { pluginId, method },
  } as never)) as Response;
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe('GET /api/plugins', () => {
  test('reports nothing loaded on a fresh process, rather than failing', async () => {
    const response = (await stateLoader({} as never)) as Response;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ loaded: [], errors: [], withRpc: [] });
  });

  test('surfaces a plugin that failed to load, with its reason', async () => {
    // The route's job is to make a dead server half VISIBLE: a plugin whose
    // factory threw has a working panel and a backend that answers 404, and
    // without this the only symptom is a method that is not there.
    globalThis.__kabmoPluginLoadErrors = [{ pluginId: PLUGIN, reason: 'the factory threw' }];
    try {
      const body = (await ((await stateLoader({} as never)) as Response).json()) as {
        errors: { pluginId: string; reason: string }[];
      };
      expect(body.errors).toEqual([{ pluginId: PLUGIN, reason: 'the factory threw' }]);
    } finally {
      globalThis.__kabmoPluginLoadErrors = undefined;
    }
  });
});

describe('the RPC route', () => {
  test('a GET is a wrong verb, not a missing endpoint', async () => {
    const response = (await rpcLoader({ request: new Request('http://x'), params: {} } as never)) as Response;
    expect(response.status).toBe(405);
  });

  test('an unknown plugin is 404 before any method is looked up', async () => {
    const result = await callRpc('ping', null, 'not-installed');
    expect(result.status).toBe(404);
  });

  test('a plugin id that could escape a path is refused as a bad request', async () => {
    const result = await callRpc('ping', null, '..%2Fetc');
    expect(result.status).toBe(400);
  });

  test('a method that answered is a 200 with its value', async () => {
    registerRpcMethod(PLUGIN, 'ping', { handler: (input: unknown) => ({ echoed: input }) });
    const result = await callRpc('ping', { a: 1 });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, value: { echoed: { a: 1 } } });
  });

  test('an unknown method is 404, and the plugin is still loaded', async () => {
    registerRpcMethod(PLUGIN, 'ping', { handler: () => 1 });
    const result = await callRpc('nope', null);
    expect(result.status).toBe(404);
    expect(result.body.ok).toBe(false);
  });

  test('a handler that throws is a 200 carrying the plugin OWN reason', async () => {
    registerRpcMethod(PLUGIN, 'boom', {
      handler: () => {
        throw new Error('the plugin says no');
      },
    });
    const result = await callRpc('boom', null);
    // Not a 500: the call reached the plugin and the plugin refused. A server
    // error here would make a plugin's own decision look like a Kabmo fault.
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      ok: false,
      error: { code: 'handler_error', message: 'the plugin says no' },
    });
  });

  test('a bad argument is invalid_input with the schema issues', async () => {
    registerRpcMethod(PLUGIN, 'strict', {
      input: {
        '~standard': {
          version: 1,
          vendor: 'test',
          validate: (value: unknown) =>
            typeof value === 'string' ? { value } : { issues: [{ message: 'expected a string', path: ['name'] }] },
        },
      },
      handler: (name: string) => name.toUpperCase(),
    });

    const bad = await callRpc('strict', 42);
    expect(bad.status).toBe(200);
    const error = bad.body.error as { code: string; issues: { message: string }[] };
    expect(error.code).toBe('invalid_input');
    expect(error.issues[0]?.message).toBe('expected a string');

    expect((await callRpc('strict', 'ok')).body).toEqual({ ok: true, value: 'OK' });
  });

  test('a body that is not JSON is refused before it is parsed', async () => {
    registerRpcMethod(PLUGIN, 'ping', { handler: () => 1 });
    const result = await callRpc('ping', { [RAW]: '{ not json' });
    expect(result.status).toBe(400);
    expect((result.body.error as { code: string }).code).toBe('invalid_json');
  });

  test('an empty body is a null argument rather than a parse failure', async () => {
    registerRpcMethod(PLUGIN, 'echo', { handler: (input: unknown) => input ?? 'none' });
    const result = await callRpc('echo', { [RAW]: '' });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, value: 'none' });
  });

  test('a wrong verb on the action is a 405', async () => {
    const response = (await rpcAction({
      request: new Request('http://x', { method: 'DELETE' }),
      params: { pluginId: PLUGIN, method: 'ping' },
    } as never)) as Response;
    expect(response.status).toBe(405);
  });
});

describe('the HTTP route family', () => {
  /** A request to the plugin's own REST surface. */
  function httpRequest(path: string, init?: RequestInit): Request {
    return new Request(`http://localhost/api/plugins/${PLUGIN}/http${path}`, init);
  }

  async function callHttp(path: string, init?: RequestInit, pluginId = PLUGIN) {
    const wildcard = path.replace(/^\/+/, '');
    const response = (await httpAction({
      request: httpRequest(path, init),
      params: { pluginId, '*': wildcard },
    } as never)) as Response;
    return response;
  }

  test('an unknown plugin is 404', async () => {
    expect((await callHttp('/notes', undefined, 'not-installed')).status).toBe(404);
  });

  test('an invalid plugin id is 400', async () => {
    expect((await callHttp('/notes', undefined, 'has/slash')).status).toBe(400);
  });

  test('a registered route answers the real Request, method and all', async () => {
    const api = createPluginHttp(PLUGIN);
    api.route('/notes', (request) => Response.json({ saw: request.method }));
    const response = await callHttp('/notes', { method: 'POST' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ saw: 'POST' });
  });

  test('an undeclared path is absent rather than prefix-matched', async () => {
    const api = createPluginHttp(PLUGIN);
    api.route('/notes', () => Response.json({ ok: true }));
    expect((await callHttp('/notes/detail')).status).toBe(404);
    expect((await callHttp('/')).status).toBe(404);
  });

  test('a plugin exception becomes its own message, not a Kabmo stack', async () => {
    const api = createPluginHttp(PLUGIN);
    api.route('/boom', () => {
      throw new Error('the route says no');
    });
    const response = await callHttp('/boom');
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'the route says no' });
  });

  test('a duplicate path is refused at registration', () => {
    const api = createPluginHttp(PLUGIN);
    api.route('/notes', () => Response.json({}));
    expect(() => api.route('/notes', () => Response.json({}))).toThrow('already registered');
  });

  test('a path that could escape the family is refused at registration', () => {
    const api = createPluginHttp(PLUGIN);
    expect(() => api.route('notes', () => Response.json({}))).toThrow('must be a path starting with "/"');
    expect(() => api.route('/../etc', () => Response.json({}))).toThrow('without ".."');
  });
});
