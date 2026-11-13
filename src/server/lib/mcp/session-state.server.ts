/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The per-session MCP overrides: which servers this session turned on or off
 * against the configured list.
 *
 * A map rather than a disabled list, because both directions are real: a server
 * disabled in `mcp.json` can be enabled for one session, and an enabled one can
 * be disabled for it. Storing only the disabled names would make "enable a
 * globally disabled server" impossible to express.
 *
 * Only names that DIFFER from the configured state are stored. A settings edit
 * therefore still reaches a session that never touched that server, and a
 * toggle back to the configured value removes the row entry instead of pinning
 * the old answer forever.
 */

import { getDb } from '@/server/db.server';
import { isRecord } from '@/shared/lib/util/guards';

export type SessionMcpOverrides = Record<string, boolean>;

/** The overrides recorded for one session; `{}` when it never toggled. */
export async function readSessionMcpOverrides(sessionId: string): Promise<SessionMcpOverrides> {
  if (!sessionId) return {};
  const db = await getDb();
  const row = await db.get<{ overrides: string }>(
    'SELECT overrides FROM session_mcp_state WHERE session_id = ?',
    [sessionId],
  );
  if (!row?.overrides) return {};
  try {
    const parsed: unknown = JSON.parse(row.overrides);
    if (!isRecord(parsed)) return {};
    const overrides: SessionMcpOverrides = {};
    for (const [name, value] of Object.entries(parsed)) {
      if (typeof value === 'boolean') overrides[name] = value;
    }
    return overrides;
  } catch {
    // A corrupt blob is an empty override, not a failed spawn: the session
    // still starts with the configured list.
    return {};
  }
}

/** Replace the overrides for one session. An empty map deletes the row. */
export async function writeSessionMcpOverrides(
  sessionId: string,
  overrides: SessionMcpOverrides,
): Promise<void> {
  if (!sessionId) return;
  const db = await getDb();
  const names = Object.keys(overrides);
  if (names.length === 0) {
    await db.run('DELETE FROM session_mcp_state WHERE session_id = ?', [sessionId]);
    return;
  }
  await db.run(
    `INSERT INTO session_mcp_state (session_id, overrides, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(session_id) DO UPDATE SET overrides = excluded.overrides, updated_at = CURRENT_TIMESTAMP`,
    [sessionId, JSON.stringify(overrides)],
  );
}

/** Drop the row for a session that is being deleted. */
export async function clearSessionMcpOverrides(sessionId: string): Promise<void> {
  if (!sessionId) return;
  const db = await getDb();
  await db.run('DELETE FROM session_mcp_state WHERE session_id = ?', [sessionId]);
}
