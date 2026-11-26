/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Persistence for ACP "always allow" grants.
 *
 * A grant is a decision the operator made about a command, so it must outlive
 * the child that asked: the idle reaper kills an ACP agent after ten minutes and
 * the next prompt adopts (or spawns) another one. Keeping the set in memory made
 * the operator approve the same `bash` line again after every reclaim.
 *
 * Deliberately its own table rather than `session_ui_state`: that blob belongs
 * to the client and the session route REPLACES it wholesale, so a server-side
 * write there would be erased by the next layout save.
 */

import { getDb } from '@/server/db.server';
import type { DbClient } from '@kabmo-labs/kabmo-db/client';

const GRANTS_SQL = `
  CREATE TABLE IF NOT EXISTS acp_permission_grants (
    session_id TEXT NOT NULL,
    grant_key TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (session_id, grant_key)
  );
`;

/** Create the table on boot; the session routes touch it lazily. */
export async function ensureAcpGrantSchema(db: DbClient): Promise<void> {
  await db.exec(GRANTS_SQL);
}

/** Every key this session has already approved with "always". */
export async function loadAcpGrants(sessionId: string): Promise<string[]> {
  try {
    const db = await getDb();
    const rows = await db.all<{ grant_key: string }>(
      'SELECT grant_key FROM acp_permission_grants WHERE session_id = ?',
      [sessionId],
    );
    return rows.map((row) => row.grant_key);
  } catch {
    // no-excuse-ok: catch — an unreadable grants table is not a reason to fail
    // the spawn; the operator is asked again, which is the safe direction.
    return [];
  }
}

/** Remember one "always allow" decision. Best effort: the current turn already
 *  holds the in-memory grant, so a failed write only costs a repeat question. */
export async function saveAcpGrant(sessionId: string, grantKey: string): Promise<void> {
  try {
    const db = await getDb();
    await db.run(
      `INSERT INTO acp_permission_grants (session_id, grant_key, created_at) VALUES (?, ?, ?)
       ON CONFLICT(session_id, grant_key) DO NOTHING`,
      [sessionId, grantKey, Date.now()],
    );
  } catch {
    // no-excuse-ok: catch — see above.
  }
}

/** Drop a deleted chat's grants with the rest of its rows. */
export async function forgetAcpGrants(sessionId: string): Promise<void> {
  try {
    const db = await getDb();
    await db.run('DELETE FROM acp_permission_grants WHERE session_id = ?', [sessionId]);
  } catch {
    // no-excuse-ok: catch — the delete path reports its own failures.
  }
}
