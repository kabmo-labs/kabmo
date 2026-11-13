/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The MCP settings rows, in one place.
 *
 * Split out of the settings route so the SPAWN path can read the same list: an
 * ACP session injects the enabled servers into `session/new`, and a second
 * reader that re-derived the key or the mock default would drift from the pane
 * the user actually edited.
 */

import { DEFAULT_MCP_SERVERS } from '@/client/data/settings/mcp';
import { createSettingsListStore } from '@/server/lib/db/settings-store';
import { isMockMode } from '@/server/mock.server';
import { normalizeMcpItem } from '@/shared/lib/mcp/item';
import type { DbClient } from '@/server/lib/db/client';
import type { McpServerItem } from '@/shared/types';

export const MCP_SETTINGS_KEY = 'omp_mcp_servers';

export const mcpStore = createSettingsListStore<McpServerItem>({
  key: MCP_SETTINGS_KEY,
  mockDefaults: DEFAULT_MCP_SERVERS,
  idOf: (server) => server.id,
  singular: 'server',
  plural: 'servers',
});

/** The app-local rows, with the mock default only in mock mode. */
export async function readCustomMcpServers(db: DbClient): Promise<McpServerItem[]> {
  const stored = await mcpStore.readStored(db, { absent: isMockMode() ? DEFAULT_MCP_SERVERS : [] });
  return stored.flatMap((row) => {
    const item = normalizeMcpItem(row);
    return item ? [item] : [];
  });
}

export async function writeCustomMcpServers(db: DbClient, servers: McpServerItem[]): Promise<void> {
  await mcpStore.write(db, servers);
}
