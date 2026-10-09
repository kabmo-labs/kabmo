/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The wire contract a plugin's client and server halves share.
 *
 * Shared by both ends (like `workspace/terminal/protocol.ts` and
 * `realtime/protocol.ts`) so a name cannot drift between the side that
 * publishes and the side that subscribes. Three namespaces, and each exists
 * because the thing it names is reachable from a URL:
 *
 * - the TOPIC a plugin publishes on (the realtime hub's namespace);
 * - the ROUTE family its RPC methods answer on (the HTTP namespace);
 * - the setting keys its values live under.
 *
 * The plugin id is validated by the same grammar the manifest uses
 * (`ID_RE` in `server/lib/panels/manifest.ts`) — enforced again here, because
 * this module is what turns an id into a URL path and a `../` in an id would
 * otherwise be a path traversal.
 */

import { PLUGIN_PANEL_PREFIX } from '@/shared/lib/workspace/panel-ids';

/** Prefix every plugin realtime topic carries. */
export const PLUGIN_TOPIC_PREFIX = 'plugin';

/** The topic a plugin publishes its value on: `plugin:<pluginId>`. */
export function pluginTopic(pluginId: string): string {
  return `${PLUGIN_TOPIC_PREFIX}:${pluginId}`;
}

/** The plugin id a topic names, or null when it is not a plugin topic. */
export function pluginIdOfTopic(topic: string): string | null {
  const prefix = `${PLUGIN_TOPIC_PREFIX}:`;
  if (!topic.startsWith(prefix)) return null;
  const rest = topic.slice(prefix.length);
  if (!rest || rest.includes(':')) return null;
  return isValidPluginId(rest) ? rest : null;
}

/** The HTTP base a plugin's RPC methods answer under. */
export function pluginRpcPath(pluginId: string, method: string): string {
  return `/api/plugins/${pluginId}/rpc/${method}`;
}

/** The route pattern the binding is mounted on; `:method` is resolved per request. */
export const PLUGIN_RPC_ROUTE = '/api/plugins/:pluginId/rpc/:method';

/** Same plugin id grammar the manifest validator applies. */
const PLUGIN_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

/**
 * Whether an id is usable in a URL and a topic.
 *
 * Deliberately re-derived here rather than imported from the server's manifest
 * validator: this module is imported by the CLIENT too, and the server module
 * reads the filesystem. The two grammars agreeing is asserted by a test rather
 * than by sharing a constant between a browser module and a Bun one.
 */
export function isValidPluginId(value: unknown): value is string {
  return typeof value === 'string' && PLUGIN_ID_RE.test(value);
}

/**
 * The prefix a plugin's own panels carry, re-exported so a client that reads a
 * plugin id out of a panel key does not import the panel registry for it.
 */
export const PLUGIN_ID_PREFIX = PLUGIN_PANEL_PREFIX;
