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
