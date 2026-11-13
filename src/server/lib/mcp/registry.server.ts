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
import { pluginMcpServers } from '@/server/lib/plugins/mcp.server';
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

/**
 * Every enabled server a session in `cwd` should receive.
 *
 * A read that fails is reported and skipped: one unreadable config must not
 * stop a chat from starting, and the settings pane is where the user can see
 * the reason.
 */
export async function mcpServersFor(cwd: string): Promise<McpServerDefinition[]> {
  const definitions: McpServerDefinition[] = [];
  const seen = new Set<string>();
  const add = (definition: McpServerDefinition | null) => {
    if (!definition) return;
    const key = definition.name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    definitions.push(definition);
  };

  const user = await readUserMcpConfig();
  if (user.error) console.error(`[mcp] user config skipped: ${user.error}`);
  for (const entry of user.servers) {
    if (!isServerEnabled(entry.name, entry.config, user.disabledServers, user.enabledServers)) continue;
    add(definitionFromNative(entry.name, entry.config));
  }

  if (cwd && (await isProjectMcpConfigEnabled())) {
    const project = await readProjectMcpConfig(cwd);
    if (project.error) console.error(`[mcp] project config skipped: ${project.error}`);
    for (const entry of project.servers) {
      if (!isServerEnabled(entry.name, entry.config, user.disabledServers, user.enabledServers)) continue;
      add(definitionFromNative(entry.name, entry.config));
    }
  }

  const custom = await readCustomMcpServers(await getDb());
  for (const item of custom) {
    if (item.scope === 'this-project' && item.projectPath !== cwd) continue;
    add(definitionFromItem(item));
  }

  for (const entry of pluginMcpServers()) {
    // `id` is the plugin's own key, not part of the transport-neutral shape.
    const { id: _id, name: _name, ...server } = entry.server;
    add({ ...server, name: entry.name });
  }

  return definitions;
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
