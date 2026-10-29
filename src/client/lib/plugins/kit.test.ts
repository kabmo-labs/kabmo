/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The kit's plugin-RPC reader, and the one status it must NOT flatten.
 *
 * `callRpc` turns a plugin's answer into a `PluginRpcOutcome`. A plugin's own
 * refusal arrives as `{ ok: false, error }` at HTTP 200 and is passed through
 * untouched — that is the plugin saying no, which is a different fact from the
 * call failing.
 *
 * The case this suite exists for is the OTHER one: a 404 on the ROUTE means no
 * plugin by that id is loaded on the server. That is exactly the state a plugin
 * installed into a running Kabmo sits in until its server half loads, and a
 * panel needs to tell it apart from a broken call so it can say "the server half
 * is not running — restart" instead of showing an empty view. Reporting it as
 * the generic `bad_response` (with a message about `watch answered 404`) made
 * the distinction unrecoverable at the one place that could act on it.
 *
 * `fetch` is stubbed rather than a server booted: the mapping is a pure function
 * of the response, and a live server would add a port and a lifecycle to a test
 * about a status code.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import { installUiKit } from '@/client/lib/plugins/kit';
import { resetPluginReadiness } from '@/client/lib/plugins/readiness';
import { uiKitServices } from '@kabmo-labs/kabmo-ui';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Text', 'Element', 'SVGElement'] as const;
const saved = new Map<string, unknown>();
const realFetch = globalThis.fetch;

/** `callRpc` is optional on the services; this suite only runs where it exists. */
function callRpc(pluginId: string, method: string, input: unknown) {
  const services = uiKitServices();
  if (!services) throw new Error('the kit installed no services');
  const call = services.callRpc;
  if (!call) throw new Error('the kit installed no callRpc');
  return call(pluginId, method, input);
}

beforeEach(() => {
  const win = new Window({ url: 'http://localhost/' });
  for (const key of DOM_GLOBALS) {
    saved.set(key, Reflect.get(globalThis, key));
    Reflect.set(globalThis, key, (win as unknown as Record<string, unknown>)[key]);
  }
  installUiKit();
  // The readiness answer is cached once true, so each case starts from a
  // process that has not been asked yet.
  resetPluginReadiness();
});

afterEach(() => {
  for (const key of DOM_GLOBALS) Reflect.set(globalThis, key, saved.get(key));
  globalThis.fetch = realFetch;
});

/** Answer every request with a fixed status and body. */
function stubFetch(status: number, body: unknown): void {
  globalThis.fetch = (async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
}

describe('the kit plugin-RPC reader', () => {
  test('a 404 on the route becomes plugin_not_loaded, not bad_response', async () => {
    stubFetch(404, { error: 'No plugin "stats" is loaded' });
    const outcome = await callRpc('stats', 'watch', null);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.error.code).toBe('plugin_not_loaded');
  });

  test("a plugin's own refusal at 200 passes through untouched", async () => {
    stubFetch(200, { ok: false, error: { code: 'bad_input', message: 'nope' } });
    const outcome = await callRpc('stats', 'watch', null);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    // The plugin answered — that is a result, not a transport fault, and it must
    // not be rewritten into one.
    expect(outcome.error.code).toBe('bad_input');
  });

  test('a success carries the value', async () => {
    stubFetch(200, { ok: true, value: { watching: 2 } });
    const outcome = await callRpc('stats', 'watch', null);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('unreachable');
    expect(outcome.value).toEqual({ watching: 2 });
  });

  test('a non-JSON error status stays bad_response', async () => {
    stubFetch(500, 'boom');
    const outcome = await callRpc('stats', 'watch', null);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.error.code).toBe('bad_response');
  });
});

/**
 * The BOOT WINDOW: a restarted server answers health before it has imported its
 * plugin halves.
 *
 * The console reloads the page the moment health reports a different process,
 * so the new page's first plugin RPC can 404 against a server that is still
 * booting. Measured after a restart: `watch` fired 194 ms into the new page and
 * 404'd, its effect never re-ran (the call's identity did not change), and the
 * Stats readout stayed on `—` although the halves were up ~500 ms later.
 *
 * So a 404 on the route is retried ONCE, after the platform reports ready — and
 * only while that is still plausible: once the platform is up, the same 404 is
 * the plugin genuinely not being loaded, and it is returned as it stands.
 */
describe('a plugin call that lands during the boot window', () => {
  /** Answer by URL, so the health probe and the RPC route can differ. */
  function stubSequenced(handler: (url: string, attempt: number) => Response): void {
    let rpcAttempts = 0;
    globalThis.fetch = (async (input: unknown) => {
      const url = String(input);
      if (url.includes('/api/health')) return handler('/api/health', 0);
      rpcAttempts += 1;
      return handler(url, rpcAttempts);
    }) as unknown as typeof fetch;
  }

  const notLoaded = () => new Response(JSON.stringify({ error: 'No plugin "stats" is loaded' }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });

  test('is retried once the boot window it landed in closes, and succeeds', async () => {
    let healthReads = 0;
    stubSequenced((url, attempt) => {
      if (url === '/api/health') {
        healthReads += 1;
        // The first answer is the boot in progress — that is what licenses the
        // retry; the next one is the platform being up.
        return Response.json({ pluginsReady: healthReads > 1 });
      }
      if (attempt === 1) return notLoaded();
      return Response.json({ ok: true, value: { watching: 1 } });
    });

    const outcome = await callRpc('stats', 'watch', null);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('unreachable');
    expect(outcome.value).toEqual({ watching: 1 });
  });

  test('waits for a boot that is still running, then retries', async () => {
    let healthReads = 0;
    stubSequenced((url, attempt) => {
      if (url === '/api/health') {
        healthReads += 1;
        // The first answer says "still booting"; the second says "up".
        return Response.json({ pluginsReady: healthReads > 1 });
      }
      if (attempt === 1) return notLoaded();
      return Response.json({ ok: true, value: { watching: 1 } });
    });

    const outcome = await callRpc('stats', 'watch', null);
    expect(outcome.ok).toBe(true);
    expect(healthReads).toBeGreaterThan(1);
  });

  test('a 404 on a platform that is already up stays plugin_not_loaded, unretried', async () => {
    let rpcAttempts = 0;
    stubSequenced((url) => {
      if (url === '/api/health') return Response.json({ pluginsReady: true });
      rpcAttempts += 1;
      return notLoaded();
    });

    const outcome = await callRpc('stats', 'watch', null);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.error.code).toBe('plugin_not_loaded');
    // No boot window was observed, so the 404 is the plugin really not being
    // loaded — retrying it would only double a call that answered correctly.
    expect(rpcAttempts).toBe(1);
  });

  test('an older server with no readiness field is not waited on', async () => {
    let rpcAttempts = 0;
    stubSequenced((url) => {
      if (url === '/api/health') return Response.json({ ok: true, pid: 1 });
      rpcAttempts += 1;
      return notLoaded();
    });

    const outcome = await callRpc('stats', 'watch', null);
    expect(outcome.ok).toBe(false);
    // One attempt: an absent field is not evidence of a boot window, so there
    // is nothing to wait for and nothing to retry.
    expect(rpcAttempts).toBe(1);
  });

  test('a health probe that cannot be read is not waited on either', async () => {
    let rpcAttempts = 0;
    globalThis.fetch = (async (input: unknown) => {
      if (String(input).includes('/api/health')) throw new TypeError('fetch failed');
      rpcAttempts += 1;
      return notLoaded();
    }) as unknown as typeof fetch;

    const outcome = await callRpc('stats', 'watch', null);
    expect(outcome.ok).toBe(false);
    expect(rpcAttempts).toBe(1);
  });
});
