/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The pieces both halves of the native MCP config module need: the file shape,
 * the name grammar, the user-scope path, and the string-list reader. Split out
 * so the reader (`mcp.ts`) and the writer (`mcp-write.ts`) depend on one
 * definition instead of on each other.
 */

import { join } from 'path';
import { getAgentDir } from '@/server/lib/omp/core/paths';

export const MAX_MCP_CONFIG_BYTES = 512 * 1024;

/** omp's own server-name grammar; a name outside it is refused by the CLI too. */
export const SERVER_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export type McpServer = Record<string, unknown>;
export type McpFile = Record<string, unknown> & {
  mcpServers?: Record<string, McpServer>;
  disabledServers?: string[];
  enabledServers?: string[];
};

/** The user-scope file omp reads: `~/.omp/agent/mcp.json`. */
export function userMcpConfigPath(): string {
  return join(getAgentDir(), 'mcp.json');
}

/** The string members of a list-shaped value, ignoring everything else. */
export function stringsIn(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
