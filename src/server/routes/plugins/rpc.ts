/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `POST /api/plugins/:pluginId/rpc/:method` — call one of a plugin's methods.
 *
 * POST for every call, including a read: a method may take arguments of any
 * shape, and a GET would have to encode them in a query string the contract
 * never promised. The body is the method's input, JSON, and the answer is
 * `{ ok, value }` or `{ ok: false, error }` — a plugin's failure is a VALUE at
 * HTTP 200, because the call itself succeeded and the plugin is what said no.
 * Only a malformed request (no such plugin, no such method, a body that is not
 * JSON) is a 4xx.
 *
 * The plugin id and method come from the URL, and both are validated before
 * anything is resolved — the id reaches a map lookup and the method reaches
 * another, so a traversal segment would otherwise be a lookup in a namespace a
 * caller chose.
 */

import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { callRpcMethod, hasRpcMethods } from '@/server/lib/plugins/rpc.server';
import { isValidPluginId } from '@/shared/lib/plugins/protocol';

const MAX_BODY_BYTES = 1024 * 1024;

/** A GET on this route is a wrong verb, not a missing endpoint. */
export async function loader({ request, params }: LoaderFunctionArgs) {
  return methodNotAllowed({ request, params });
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') return methodNotAllowed({ request, params });

  const pluginId = params.pluginId ?? '';
  const method = params.method ?? '';
  if (!isValidPluginId(pluginId)) return json({ error: 'Invalid plugin id' }, { status: 400 });
  if (!hasRpcMethods(pluginId)) return json({ error: `No plugin "${pluginId}" is loaded` }, { status: 404 });

  // Read as text first: a body over the limit must be refused BEFORE it is
  // parsed, or a large payload is buffered and decoded to reject it.
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: 'Request body is too large' }, { status: 413 });

  let input: unknown = null;
  if (text.trim()) {
    try {
      input = JSON.parse(text);
    } catch {
      return json({ ok: false, error: { code: 'invalid_json', message: 'the body is not valid JSON' } }, { status: 400 });
    }
  }

  const result = await callRpcMethod(pluginId, method, input, {
    url: request.url,
    signal: request.signal,
  });
  if (!result.ok && result.error.code === 'unknown_method') {
    return json({ ok: false, error: result.error }, { status: 404 });
  }
  return json(result, { headers: { 'cache-control': 'no-store' } });
}
