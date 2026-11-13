/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The MCP servers a session should receive, from every source that can declare
 * one.
 *
 * One list, because the alternative is what shipped before: the settings pane
 * read omp's `mcp.json`, the ACP spawn passed `mcpServers: []`, and a plugin had
 * no way to contribute at all. A server the user configured therefore reached
 * exactly one harness — the one that happened to read the same file.
 *
 * Precedence is by NAME, first wins: native user config, then the project's
 * config, then the app-local rows, then plugin contributions. That is the same
 * rule the settings pane merges with, so the list a user sees and the list a
 * session receives cannot disagree about which entry is live.
 *
 * Enablement is omp's own: the user-level `disabledServers` denylist wins, then
 * the entry's `enabled: false`, then the `enabledServers` allowlist. A server
 * disabled in `mcp.json` must not reach a session just because Kabmo read the
 * file itself.
 */

import { getDb } from '@/server/db.server';
import {
  isProjectMcpConfigEnabled,
  isServerEnabled,
  readProjectMcpConfig,
  readUserMcpConfig,
} from '@/server/lib/omp/config/mcp';
import type { McpServer } from '@/server/lib/omp/config/mcp-shared';
import { readCustomMcpServers } from '@/server/lib/mcp/store.server';
import { pluginMcpServers, type RegisteredPluginMcpServer } from '@/server/lib/plugins/mcp.server';
import type { SessionMcpOverrides } from '@/server/lib/mcp/session-state.server';
import type { McpServerItem, McpTransport } from '@/shared/types';
import { rowsToRecord } from '@/shared/lib/mcp/key-value';
import type { AcpMcpServer } from '@/server/lib/harness/acp/protocol';

/** One server, in the transport-neutral shape both deliveries read. */
export interface McpServerDefinition {
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  /** Per-request timeout in milliseconds; 0 disables client-side timeouts. */
  timeout?: number;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/** A native `mcp.json` entry, or null when it names neither a command nor a URL. */
export function definitionFromNative(name: string, config: McpServer): McpServerDefinition | null {
  const timeout = typeof config.timeout === 'number' ? config.timeout : undefined;
  if (typeof config.url === 'string' && config.url.trim()) {
    const headers = stringRecord(config.headers);
    const transport: McpTransport = config.type === 'sse' ? 'sse' : 'http';
    return {
      name,
      transport,
      url: config.url.trim(),
      ...(headers ? { headers } : {}),
      ...(timeout !== undefined ? { timeout } : {}),
    };
  }
  if (typeof config.command === 'string' && config.command.trim()) {
    const args = Array.isArray(config.args) ? config.args.filter((arg): arg is string => typeof arg === 'string') : [];
    const env = stringRecord(config.env);
    return {
      name,
      transport: 'stdio',
      command: config.command.trim(),
      ...(args.length > 0 ? { args } : {}),
      ...(env ? { env } : {}),
      ...(typeof config.cwd === 'string' && config.cwd.trim() ? { cwd: config.cwd.trim() } : {}),
      ...(timeout !== undefined ? { timeout } : {}),
    };
  }
  return null;
}

/** An app-local settings row, or null when it is disabled or malformed. */
export function definitionFromItem(item: McpServerItem): McpServerDefinition | null {
  if (!item.enabled) return null;
  const transport: McpTransport = item.transport ?? (item.linkUrl ? 'http' : 'stdio');
  const timeout = typeof item.timeout === 'number' ? item.timeout : undefined;
  if (transport !== 'stdio') {
    const url = (item.linkUrl ?? item.commandArgs[0] ?? '').trim();
    if (!url) return null;
    const headers = rowsToRecord(item.headers);
    return {
      name: item.name,
      transport,
      url,
      ...(headers ? { headers } : {}),
      ...(timeout !== undefined ? { timeout } : {}),
    };
  }
  const [command, ...args] = item.commandArgs;
  if (!command?.trim()) return null;
  const env = rowsToRecord(item.envVars);
  return {
    name: item.name,
    transport: 'stdio',
    command: command.trim(),
    ...(args.length > 0 ? { args } : {}),
    ...(env ? { env } : {}),
    ...(item.cwd?.trim() ? { cwd: item.cwd.trim() } : {}),
    ...(timeout !== undefined ? { timeout } : {}),
  };
}

/** Where a server was declared. The settings pane and the session list both
 *  need it, and a second derivation would drift from this one. */
export type McpServerSource = 'user' | 'project' | 'custom' | 'plugin';

/**
 * One server as the session sees it: the native `mcp.json` shape (so a
 * per-session overlay can write it back verbatim, credentials included), the
 * transport for display, and the enablement AFTER the session's overrides.
 */
export interface McpServerEntry {
  name: string;
  config: McpServer;
  transport: McpTransport;
  source: McpServerSource;
  enabled: boolean;
}

/** The transport a native entry names, by the same rule `definitionFromNative` uses. */
function transportOf(config: McpServer): McpTransport {
  if (typeof config.url === 'string' && config.url.trim()) return config.type === 'sse' ? 'sse' : 'http';
  return 'stdio';
}

/** An app-local row in omp's native shape. Redacted credentials are dropped,
 *  exactly as `definitionFromItem` drops them — the sentinel is a display
 *  placeholder and must never be written to a config file. */
function nativeFromItem(item: McpServerItem): McpServer | null {
  const transport: McpTransport = item.transport ?? (item.linkUrl ? 'http' : 'stdio');
  const timeout = typeof item.timeout === 'number' ? item.timeout : undefined;
  if (transport !== 'stdio') {
    const url = (item.linkUrl ?? item.commandArgs[0] ?? '').trim();
    if (!url) return null;
    const headers = rowsToRecord(item.headers);
    return {
      type: transport,
      url,
      ...(headers ? { headers } : {}),
      ...(timeout !== undefined ? { timeout } : {}),
    };
  }
  const [command, ...args] = item.commandArgs;
  if (!command?.trim()) return null;
  const env = rowsToRecord(item.envVars);
  return {
    command: command.trim(),
    ...(args.length > 0 ? { args } : {}),
    ...(env ? { env } : {}),
    ...(item.cwd?.trim() ? { cwd: item.cwd.trim() } : {}),
    ...(timeout !== undefined ? { timeout } : {}),
  };
}

/** A plugin contribution in omp's native shape. */
function nativeFromPlugin(server: RegisteredPluginMcpServer['server']): McpServer {
  if (server.transport === 'stdio') {
    return {
      command: server.command ?? '',
      ...(server.args?.length ? { args: server.args } : {}),
      ...(server.env ? { env: server.env } : {}),
    };
  }
  return {
    type: server.transport,
    url: server.url ?? '',
    ...(server.headers ? { headers: server.headers } : {}),
  };
}

/**
 * Every server a session in `cwd` can see, enabled or not, with the session's
 * overrides applied.
 *
 * This is the ONE merge: the settings pane, the ACP injection, the omp-rpc
 * overlay and the navbar list all read it, so they cannot disagree about which
 * entry is live. Precedence is by NAME, first wins: user, project, app-local,
 * plugin.
 *
 * `overrides` is the per-session map (`true` = enabled, `false` = disabled).
 * A name absent from it keeps the configured state, which is what lets a
 * settings edit reach a session that never touched that server.
 */
export async function mcpServerEntriesFor(
  cwd: string,
  options: { overrides?: SessionMcpOverrides; sources?: readonly McpServerSource[] } = {},
): Promise<McpServerEntry[]> {
  const overrides = options.overrides ?? {};
  const wanted = options.sources ? new Set(options.sources) : null;
  const entries: McpServerEntry[] = [];
  const seen = new Set<string>();
  const add = (entry: McpServerEntry | null) => {
    if (!entry) return;
    if (wanted && !wanted.has(entry.source)) return;
    const key = entry.name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const override = overrides[entry.name];
    entries.push({ ...entry, enabled: override === undefined ? entry.enabled : override });
  };

  const user = await readUserMcpConfig();
  if (user.error) console.error(`[mcp] user config skipped: ${user.error}`);
  for (const entry of user.servers) {
    add({
      name: entry.name,
      config: entry.config,
      transport: transportOf(entry.config),
      source: 'user',
      enabled: isServerEnabled(entry.name, entry.config, user.disabledServers, user.enabledServers),
    });
  }

  if (cwd && (await isProjectMcpConfigEnabled())) {
    const project = await readProjectMcpConfig(cwd);
    if (project.error) console.error(`[mcp] project config skipped: ${project.error}`);
    for (const entry of project.servers) {
      add({
        name: entry.name,
        config: entry.config,
        transport: transportOf(entry.config),
        source: 'project',
        enabled: isServerEnabled(entry.name, entry.config, user.disabledServers, user.enabledServers),
      });
    }
  }

  if (!wanted || wanted.has('custom')) {
    const custom = await readCustomMcpServers(await getDb());
    for (const item of custom) {
      if (item.scope === 'this-project' && item.projectPath !== cwd) continue;
      const config = nativeFromItem(item);
      if (!config) continue;
      add({ name: item.name, config, transport: transportOf(config), source: 'custom', enabled: item.enabled });
    }
  }

  if (!wanted || wanted.has('plugin')) {
    for (const entry of pluginMcpServers()) {
      const config = nativeFromPlugin(entry.server);
      add({ name: entry.name, config, transport: transportOf(config), source: 'plugin', enabled: true });
    }
  }

  return entries;
}

/**
 * Every ENABLED server a session in `cwd` should receive, in the
 * transport-neutral shape the ACP handshake and the settings pane consume.
 *
 * A read that fails is reported and skipped: one unreadable config must not
 * stop a chat from starting, and the settings pane is where the user can see
 * the reason.
 */
export async function mcpServersFor(
  cwd: string,
  options: { overrides?: SessionMcpOverrides } = {},
): Promise<McpServerDefinition[]> {
  const entries = await mcpServerEntriesFor(cwd, options);
  return entries.flatMap((entry) => {
    if (!entry.enabled) return [];
    const definition = definitionFromNative(entry.name, entry.config);
    return definition ? [definition] : [];
  });
}

/** The ACP wire shape: stdio is the baseline, `http`/`sse` are the typed variants. */
export function toAcpMcpServers(definitions: readonly McpServerDefinition[]): AcpMcpServer[] {
  return definitions.map((definition) =>
    definition.transport === 'stdio'
      ? {
          name: definition.name,
          command: definition.command ?? '',
          args: definition.args ?? [],
          env: Object.entries(definition.env ?? {}).map(([name, value]) => ({ name, value })),
        }
      : {
          type: definition.transport,
          name: definition.name,
          url: definition.url ?? '',
          headers: Object.entries(definition.headers ?? {}).map(([name, value]) => ({ name, value })),
        },
  );
}
