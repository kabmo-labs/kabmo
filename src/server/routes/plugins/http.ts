/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `ALL /api/plugins/:pluginId/http/*` — a plugin's own REST surface.
 *
 * A single wildcard binding rather than one Elysia route per plugin: a plugin's
 * routes are registered at LOAD time, while Elysia's routing table is built at
 * boot, so mounting them individually would mean either a restart per plugin or
 * a table that grows with third-party code. The lookup is a map hit inside one
 * handler, which also means a plugin that registers a route after the server is
 * listening is reachable immediately.
 *
 * The handler receives the REAL `Request` — method, headers, body, signal — and
 * returns a `Response`, exactly as a route module's loader does. Nothing is
 * adapted, so a plugin can stream, set a status, or read a body without the
 * host standing in the middle.
 */

import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { findHttpRoute, hasHttpRoutes } from '@/server/lib/plugins/http.server';
import { isValidPluginId } from '@/shared/lib/plugins/protocol';

/** The prefix the wildcard captures, without a trailing slash. */
const BASE = '/api/plugins';

async function serve({ request, params }: LoaderFunctionArgs | ActionFunctionArgs): Promise<Response> {
  const pluginId = params.pluginId ?? '';
  if (!isValidPluginId(pluginId)) return json({ error: 'Invalid plugin id' }, { status: 400 });
  if (!hasHttpRoutes(pluginId)) return json({ error: `No plugin "${pluginId}" is loaded` }, { status: 404 });

  const wildcard = params['*'] ?? '';
  const path = wildcard ? `/${wildcard.replace(/^\/+/, '')}` : '/';
  const route = findHttpRoute(pluginId, path);
  if (!route) return json({ error: `No route "${path}" on plugin "${pluginId}"` }, { status: 404 });

  try {
    return await route.handler(request);
  } catch (error) {
    // A plugin's exception is reported as ITS failure, with its own message:
    // the alternative is a 500 whose body describes Kabmo rather than
    // what the plugin did.
    return json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export const loader = serve;
export const action = serve;

/** The mount path, so `bindings.ts` and the docs state one string. */
export const PLUGIN_HTTP_ROUTE = `${BASE}/:pluginId/http/*`;
