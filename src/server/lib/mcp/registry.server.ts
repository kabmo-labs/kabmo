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
 */

import { getDb } from '@/server/db.server';
import { readProjectMcpConfig, readUserMcpConfig, type McpServer } from '@/server/lib/omp/config/mcp';
import { readCustomMcpServers } from '@/server/lib/mcp/store.server';
import { pluginMcpServers } from '@/server/lib/plugins/mcp.server';
import type { McpServerItem } from '@/shared/types';
import type { AcpMcpServer } from '@/server/lib/harness/acp/protocol';

/** One server, in the transport-neutral shape both deliveries read. */
export interface McpServerDefinition {
  name: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/** A native `mcp.json` entry, or null when it names neither a command nor a URL. */
export function definitionFromNative(name: string, config: McpServer): McpServerDefinition | null {
  if (typeof config.url === 'string' && config.url.trim()) {
    const headers = stringRecord(config.headers);
    return { name, transport: 'http', url: config.url.trim(), ...(headers ? { headers } : {}) };
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
    };
  }
  return null;
}

/** An app-local settings row, or null when it is disabled or malformed. */
export function definitionFromItem(item: McpServerItem): McpServerDefinition | null {
  if (!item.enabled) return null;
  if (item.reachType === 'link' || item.linkUrl) {
    const url = (item.linkUrl ?? item.commandArgs[0] ?? '').trim();
    return url ? { name: item.name, transport: 'http', url } : null;
  }
  const [command, ...args] = item.commandArgs;
  if (!command?.trim()) return null;
  const env: Record<string, string> = {};
  for (const entry of item.envVars ?? []) {
    // A masked value is a display placeholder, never a credential: injecting it
    // would hand the agent the literal dots.
    if (entry?.key && entry.value && entry.value !== '••••••••') env[entry.key] = entry.value;
  }
  return {
    name: item.name,
    transport: 'stdio',
    command: command.trim(),
    ...(args.length > 0 ? { args } : {}),
    ...(Object.keys(env).length > 0 ? { env } : {}),
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
    if (user.disabledServers.includes(entry.name)) continue;
    add(definitionFromNative(entry.name, entry.config));
  }

  if (cwd) {
    const project = await readProjectMcpConfig(cwd);
    if (project.error) console.error(`[mcp] project config skipped: ${project.error}`);
    for (const entry of project.servers) {
      if (project.disabledServers.includes(entry.name)) continue;
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

/** The ACP wire shape: stdio is the baseline, `http` is the typed variant. */
export function toAcpMcpServers(definitions: readonly McpServerDefinition[]): AcpMcpServer[] {
  return definitions.map((definition) =>
    definition.transport === 'http'
      ? {
          type: 'http' as const,
          name: definition.name,
          url: definition.url ?? '',
          headers: Object.entries(definition.headers ?? {}).map(([name, value]) => ({ name, value })),
        }
      : {
          name: definition.name,
          command: definition.command ?? '',
          args: definition.args ?? [],
          env: Object.entries(definition.env ?? {}).map(([name, value]) => ({ name, value })),
        },
  );
}
