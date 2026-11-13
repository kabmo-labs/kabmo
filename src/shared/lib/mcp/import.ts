/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Importing MCP server definitions pasted from another tool.
 *
 * Every shape below is a real file format, not a guess:
 *  - `{ mcpServers: {...} }` — omp, Claude Code, Claude Desktop, Gemini
 *    (`httpUrl` instead of `url` for remote servers);
 *  - `{ servers: {...} }` — VS Code `.vscode/mcp.json` (`type: stdio|http|sse`);
 *  - `{ mcp: {...} }` — OpenCode (`type: local|remote`, `command` as an array,
 *    `environment` instead of `env`).
 *
 * ALL servers in the snippet are imported, not the first one: a pasted file
 * with five servers silently keeping one was the previous behaviour.
 */

import type { McpAuthConfig, McpKeyValue, McpOAuthConfig, McpServerItem, McpTransport } from '@/shared/types';
import { isRecord } from '@/shared/lib/util/guards';

function rows(value: unknown, prefix: string): McpKeyValue[] {
  if (!isRecord(value)) return [];
  return Object.entries(value).map(([key, entry], index) => ({
    id: `${prefix}-${index}`,
    key,
    value: typeof entry === 'string' ? entry : String(entry),
  }));
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

/** The `serverConfig` shape shared by every format, mapped field by field. */
function toItem(name: string, config: Record<string, unknown>, index: number): McpServerItem {
  const url = typeof config.url === 'string'
    ? config.url
    : typeof config.httpUrl === 'string'
      ? config.httpUrl
      : undefined;
  const declared = typeof config.type === 'string' ? config.type : '';
  const transport: McpTransport = declared === 'sse'
    ? 'sse'
    : declared === 'http' || declared === 'remote' || (url && declared !== 'stdio' && declared !== 'local')
      ? 'http'
      : 'stdio';

  const commandArgs = Array.isArray(config.command)
    ? config.command.map(String)
    : typeof config.command === 'string'
      ? [config.command, ...strings(config.args)]
      : [];

  const item: McpServerItem = {
    id: `import-${index}-${name}`,
    name,
    scope: 'every-project',
    enabled: config.enabled !== false,
    transport,
    commandArgs: transport === 'stdio' ? commandArgs : [url ?? ''],
    ...(transport === 'stdio' ? {} : { linkUrl: url ?? '' }),
    envVars: rows(config.env ?? config.environment, `env-${index}`),
    headers: rows(config.headers, `header-${index}`),
    status: 'active',
  };
  if (typeof config.cwd === 'string') item.cwd = config.cwd;
  if (typeof config.timeout === 'number') item.timeout = config.timeout;
  if (typeof config.instructions === 'boolean') item.instructions = config.instructions;
  if (isRecord(config.auth)) item.auth = config.auth as unknown as McpAuthConfig;
  if (isRecord(config.oauth)) item.oauth = config.oauth as unknown as McpOAuthConfig;
  return item;
}

/** The map of server definitions inside a snippet, whatever envelope it uses. */
function serverMap(parsed: Record<string, unknown>): Record<string, unknown> | null {
  for (const key of ['mcpServers', 'servers', 'mcp']) {
    const value = parsed[key];
    if (isRecord(value)) return value;
  }
  return null;
}

/**
 * Parse a pasted JSON snippet into server rows. Throws with a sentence the
 * dialog shows verbatim; an envelope with no entries is an error, not an empty
 * import that looks like it worked.
 */
export function parseMcpImport(text: string): McpServerItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That is not valid JSON.');
  }
  if (!isRecord(parsed)) throw new Error('Paste a JSON object, not a list or a bare value.');

  const map = serverMap(parsed);
  if (map) {
    const entries = Object.entries(map).filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]));
    if (entries.length === 0) throw new Error('No server definitions found in that snippet.');
    return entries.map(([name, config], index) => toItem(name, config, index));
  }

  // A single bare definition: { name?, command } or { name?, url }.
  if (typeof parsed.command !== 'string' && typeof parsed.url !== 'string' && typeof parsed.httpUrl !== 'string') {
    throw new Error('No server definitions found in that snippet.');
  }
  const name = typeof parsed.name === 'string' && parsed.name ? parsed.name : 'imported-mcp-server';
  return [toItem(name, parsed, 0)];
}
