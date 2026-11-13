/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Per-session MCP enablement, persisted.
 *
 * The list a session receives is a SPAWN property: omp reads `mcp.json` once at
 * start, and an ACP agent receives `mcpServers` on `session/new`. A toggle that
 * only lived in the client would therefore be lost on the next respawn (idle
 * reclaim, a restart, a second instance), so the override is a server row keyed
 * by the session id — the same keying `harness_sessions` uses.
 *
 * Deliberately NOT `session_ui_state`: that blob is the client's whole layout
 * and is written by the browser, while this row is read by the spawn path
 * before any client exists.
 */

import type { DbClient } from '@/server/lib/db/client';

const SESSION_MCP_SQL = `
  CREATE TABLE IF NOT EXISTS session_mcp_state (
    session_id TEXT PRIMARY KEY,
    -- JSON object: server name -> true (enabled) | false (disabled). Only the
    -- names that DIFFER from the configured state are stored, so a settings
    -- change still reaches a session that never overrode that server.
    overrides TEXT NOT NULL DEFAULT '{}',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`;

export async function ensureSessionMcpSchema(db: DbClient): Promise<void> {
  await db.exec(SESSION_MCP_SQL);
}
