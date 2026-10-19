/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A plugin's own HTTP surface, under `/api/plugins/<id>/http/*`.
 *
 * Separate from RPC because the two answer different callers. An RPC method is
 * named and called by the plugin's OWN client half; an HTTP route is a plain
 * `Request → Response` handler, which is what a webhook receiver, a shareable
 * URL or a stream needs. A plugin author writes the same shape a route module's
 * loader is, so there is nothing new to learn.
 *
 * Paths are matched EXACTLY (after the plugin's prefix). A prefix rule would
 * swallow paths the plugin never declared, and since the prefix is the plugin's
 * own id the failure mode of a loose match is a route answering for another
 * route's URL — the kind of bug that is invisible until two plugins both use
 * `/status`.
 */

import type { PluginHttpApi } from '@kabmo-labs/kabmo-sdk';

/** One registered route: the path as the plugin wrote it, and its handler. */
export interface RegisteredHttpRoute {
  pluginId: string;
  path: string;
  handler: (request: Request) => Response | Promise<Response>;
}

/**
 * The routes, keyed `<pluginId>\0<path>`.
 *
 * Process-wide for the reason every other plugin registry is: under `bun --hot`
 * this module re-evaluates while loaded plugins still hold the disposers they
 * were handed, and a module-level map would come back empty.
 */
declare global {
  // eslint-disable-next-line no-var
  var __kabmoPluginHttpRoutes: Map<string, RegisteredHttpRoute> | undefined;
}

const routeKey = (pluginId: string, path: string) => `${pluginId}\u0000${path}`;

function routes(): Map<string, RegisteredHttpRoute> {
  return (globalThis.__kabmoPluginHttpRoutes ??= new Map());
}

/** Normalize a declared path: one leading slash, no trailing one. */
function normalizePath(path: string): string | null {
  const trimmed = path.trim();
  if (!trimmed.startsWith('/')) return null;
  const collapsed = trimmed.replace(/\/+$/, '') || '/';
  // `..` and a NUL are refused here as well as at the route, because this is
  // the value that reaches the URL match: a path the plugin could not have
  // meant is better refused at declaration, where the plugin author sees it.
  if (collapsed.includes('..') || collapsed.includes('\u0000')) return null;
  return collapsed;
}

/** The API one plugin is handed at load. */
export function createPluginHttp(pluginId: string): PluginHttpApi {
  return {
    route(path, handler) {
      const normalized = normalizePath(path);
      if (!normalized) throw new Error(`http route "${path}" must be a path starting with "/" and without ".."`);
      if (typeof handler !== 'function') throw new Error(`http route "${normalized}" has no handler`);
      const map = routes();
      const key = routeKey(pluginId, normalized);
      if (map.has(key)) throw new Error(`http route "${normalized}" is already registered by this plugin`);
      map.set(key, { pluginId, path: normalized, handler });
      return () => {
        map.delete(key);
      };
    },
  };
}

/**
 * Resolve a request to a route's handler.
 *
 * `path` is what follows `/api/plugins/<id>/http` in the URL. The lookup is a
 * map hit, never a filesystem read or a prefix walk, so a path the plugin did
 * not declare is simply absent.
 */
export function findHttpRoute(
  pluginId: string,
  path: string,
): RegisteredHttpRoute | undefined {
  return routes().get(routeKey(pluginId, normalizePath(path) ?? ''));
}

/** Whether a plugin has any route registered, so the route can 404 early. */
export function hasHttpRoutes(pluginId: string): boolean {
  for (const route of routes().values()) {
    if (route.pluginId === pluginId) return true;
  }
  return false;
}

/** Drop every route a plugin registered — called from its disposal pass. */
export function clearPluginHttpRoutes(pluginId: string): void {
  const map = routes();
  for (const [key, route] of map) {
    if (route.pluginId === pluginId) map.delete(key);
  }
}

/** Test seam: forget every registration. */
export function resetPluginHttp(): void {
  routes().clear();
}
