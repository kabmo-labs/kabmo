/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Normalizing one stored MCP row.
 *
 * Rows written before the transport field existed carry `reachType: 'link'`
 * and no `headers`, and a few carry neither list. Reading is the one place
 * that boundary can be absorbed, so every consumer — the settings pane, the
 * session registry, the connection test — sees the same complete shape and no
 * caller has to special-case an old row.
 */

import type { McpKeyValue, McpScope, McpServerItem, McpTransport } from '@/shared/types';
import { isRecord } from '@/shared/lib/util/guards';

function rows(value: unknown): McpKeyValue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (!isRecord(entry)) return [];
    const key = typeof entry.key === 'string' ? entry.key : '';
    const item = typeof entry.id === 'string' ? entry.id : `row-${index}`;
    return [{ id: item, key, value: typeof entry.value === 'string' ? entry.value : String(entry.value ?? '') }];
  });
}

/** Fill every field a form or a transport writer reads; drop the legacy alias. */
export function normalizeMcpItem(row: unknown): McpServerItem | null {
  if (!isRecord(row)) return null;
  if (typeof row.id !== 'string' || typeof row.name !== 'string' || !row.name) return null;
  const scope: McpScope = row.scope === 'this-project' ? 'this-project' : 'every-project';
  const linkUrl = typeof row.linkUrl === 'string' ? row.linkUrl : undefined;
  const transport: McpTransport =
    row.transport === 'sse' || row.transport === 'http' || row.transport === 'stdio'
      ? row.transport
      : row.reachType === 'link' || linkUrl
        ? 'http'
        : 'stdio';
  const item: McpServerItem = {
    id: row.id,
    name: row.name,
    scope,
    enabled: row.enabled !== false,
    transport,
    commandArgs: Array.isArray(row.commandArgs) ? row.commandArgs.map(String) : [],
    envVars: rows(row.envVars),
    headers: rows(row.headers),
  };
  if (typeof row.projectPath === 'string') item.projectPath = row.projectPath;
  if (linkUrl) item.linkUrl = linkUrl;
  if (typeof row.cwd === 'string') item.cwd = row.cwd;
  if (typeof row.timeout === 'number') item.timeout = row.timeout;
  if (row.requestIdFormat === 'string' || row.requestIdFormat === 'number') item.requestIdFormat = row.requestIdFormat;
  if (typeof row.instructions === 'boolean') item.instructions = row.instructions;
  if (isRecord(row.auth)) item.auth = row.auth as unknown as McpServerItem['auth'];
  if (isRecord(row.oauth)) item.oauth = row.oauth as unknown as McpServerItem['oauth'];
  if (row.status === 'active' || row.status === 'inactive' || row.status === 'error') item.status = row.status;
  return item;
}
