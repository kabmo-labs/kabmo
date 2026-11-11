/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The MCP servers plugins contribute.
 *
 * A plugin declares a server; the host owns delivery. That split is the same
 * one `background` follows: a plugin that spawned its own MCP child would leak
 * one on every reload, and it would have to know which harness the user picked.
 * Here the registry is the single list the spawn path reads, and disposal is
 * the loader's job.
 *
 * Process-wide for the reason every other plugin registry is: under `bun --hot`
 * this module re-evaluates while loaded plugins still hold the API they were
 * handed, and a module-level map would come back empty.
 */

import type { PluginMcpApi, PluginMcpServer } from '@kabmo-labs/kabmo-sdk';

/** One registration, with the plugin it belongs to and the name agents see. */
export interface RegisteredPluginMcpServer {
  pluginId: string;
  server: PluginMcpServer;
  /** `<pluginId>:<id>` unless the plugin stated a name. */
  name: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __kabmoPluginMcpServers: Map<string, RegisteredPluginMcpServer[]> | undefined;
}

function registry(): Map<string, RegisteredPluginMcpServer[]> {
  return (globalThis.__kabmoPluginMcpServers ??= new Map());
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
}

/** Refuse a malformed declaration by name, rather than registering a server that cannot start. */
function validate(pluginId: string, server: PluginMcpServer): RegisteredPluginMcpServer {
  if (!server || typeof server !== 'object') throw new Error('mcp.register expects a server object');
  if (typeof server.id !== 'string' || !server.id.trim()) throw new Error('mcp.register: "id" is required');
  if (server.transport !== 'stdio' && server.transport !== 'http') {
    throw new Error(`mcp.register "${server.id}": transport must be "stdio" or "http"`);
  }
  if (server.transport === 'stdio') {
    if (typeof server.command !== 'string' || !server.command.trim()) {
      throw new Error(`mcp.register "${server.id}": a stdio server needs a command`);
    }
    if (server.args !== undefined && (!Array.isArray(server.args) || server.args.some((arg) => typeof arg !== 'string'))) {
      throw new Error(`mcp.register "${server.id}": args must be a string array`);
    }
    if (server.env !== undefined && !isStringRecord(server.env)) {
      throw new Error(`mcp.register "${server.id}": env must be a string map`);
    }
  } else {
    if (typeof server.url !== 'string' || !server.url.trim()) {
      throw new Error(`mcp.register "${server.id}": an http server needs a url`);
    }
    if (server.headers !== undefined && !isStringRecord(server.headers)) {
      throw new Error(`mcp.register "${server.id}": headers must be a string map`);
    }
  }
  const name = typeof server.name === 'string' && server.name.trim() ? server.name.trim() : `${pluginId}:${server.id}`;
  return { pluginId, server, name };
}

/** The API one plugin is handed at load. */
export function createPluginMcp(pluginId: string): PluginMcpApi {
  return {
    register(server) {
      const checked = validate(pluginId, server);
      const list = registry().get(pluginId) ?? [];
      if (list.some((entry) => entry.server.id === checked.server.id)) {
        throw new Error(`mcp.register: "${checked.server.id}" is already registered by this plugin`);
      }
      list.push(checked);
      registry().set(pluginId, list);
    },
  };
}

/** Drop every server a plugin contributed (disable, removal, reload). */
export function clearPluginMcp(pluginId: string): void {
  registry().delete(pluginId);
}

/** Every contributed server, in load order. */
export function pluginMcpServers(): RegisteredPluginMcpServer[] {
  return [...registry().values()].flat();
}
