/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Read and write the persisted harness of a session.
 *
 * `spawn` writes once; the sidebar reads every folder load. Both go through this
 * module so the column names appear in one file — a second caller spelling them
 * out is how a rename leaves one read returning null.
 *
 * A FAILED WRITE IS NOT SWALLOWED silently at the call site: the spawn logs it.
 * The session still runs (the spawn must not fail because a label could not be
 * stored), but a silently missing row is exactly the bug this table exists to
 * fix, so the failure is reported where it can be seen.
 */

import { getDb } from '@/server/db.server';
import type { HarnessId } from '@/shared/lib/harness/catalog';

export interface HarnessSessionRecord {
  sessionId: string;
  harness: string;
  /** The id the AGENT reported, when it differs from Kabmo's. */
  agentSessionId: string;
  cwd: string;
}

/** Record which harness owns a session. Idempotent: a re-spawn of the same id
 *  UPDATES the row rather than failing on the primary key. */
export async function saveHarnessSession(record: HarnessSessionRecord): Promise<void> {
  const now = Date.now();
  const db = await getDb();
  await db.run(
    `INSERT INTO harness_sessions (session_id, harness, agent_session_id, cwd, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       harness = excluded.harness,
       agent_session_id = excluded.agent_session_id,
       cwd = excluded.cwd,
       updated_at = excluded.updated_at`,
    [record.sessionId, record.harness, record.agentSessionId, record.cwd, now, now],
  );
}

export interface HarnessSessionRow {
  sessionId: string;
  harness: string;
  agentSessionId: string;
  cwd: string;
  updatedAt: number;
}

/**
 * Every recorded session that did NOT come from omp's JSONL store.
 *
 * Those rows are the ones the sidebar cannot discover on its own: an ACP agent
 * writes no session file, so a chat spawned on `opencode` existed in the
 * registry and in no list at all — it vanished from the sidebar the moment its
 * tab closed.
 *
 * `harness <> 'omp-rpc'` is a cheap PRE-FILTER, not the rule: an omp row is
 * persisted here too (its resume id lives in this table), and loading one per
 * discovered session only to discard it is work the scan already did.
 *
 * The rule that actually removes duplicates lives where the two lists MERGE
 * (`sidebar-data.server.ts`), because the pre-filter cannot express it: `omp-acp`
 * is omp itself over the Agent Client Protocol, so its chats are ordinary
 * `.jsonl` files the scan finds — and, being neither `omp-rpc` nor an ACP
 * adapter, they passed this filter and drew TWO rows carrying one id.
 */
export async function loadAcpSessions(): Promise<HarnessSessionRow[]> {
  const db = await getDb();
  const rows = (await db.all(
    `SELECT session_id, harness, agent_session_id, cwd, updated_at
       FROM harness_sessions
      WHERE harness <> 'omp-rpc'
      ORDER BY updated_at DESC`,
  )) as { session_id: string; harness: string; agent_session_id: string; cwd: string; updated_at: number }[];
  return rows.map((row) => ({
    sessionId: row.session_id,
    harness: row.harness,
    agentSessionId: row.agent_session_id,
    cwd: row.cwd,
    updatedAt: row.updated_at,
  }));
}

/** The agent's own id for a session, for resuming it. Null when the row has
 *  none (an RPC session) or the session was never recorded. */
export async function loadAgentSessionId(sessionId: string): Promise<string | null> {
  const row = await loadHarnessSession(sessionId);
  return row && row.agentSessionId ? row.agentSessionId : null;
}

/** session id → harness id, for every session this database knows about.
 *
 *  A Map rather than a per-row query: the sidebar assembles hundreds of rows in
 *  one pass, and one read for the whole answer is the difference between one
 *  query and one per session. */
export async function loadHarnessBySession(): Promise<Map<string, string>> {
  const db = await getDb();
  const rows = (await db.all('SELECT session_id, harness FROM harness_sessions')) as {
    session_id: string;
    harness: string;
  }[];
  return new Map(rows.map((row) => [row.session_id, row.harness]));
}

/** The row for one session, or null. */
export async function loadHarnessSession(sessionId: string): Promise<HarnessSessionRecord | null> {
  const db = await getDb();
  const row = (await db.get(
    'SELECT session_id, harness, agent_session_id, cwd FROM harness_sessions WHERE session_id = ?',
    [sessionId],
  )) as { session_id: string; harness: string; agent_session_id: string; cwd: string } | null;
  if (!row) return null;
  return {
    sessionId: row.session_id,
    harness: row.harness,
    agentSessionId: row.agent_session_id,
    cwd: row.cwd,
  };
}

/** Narrow a stored value to a harness this build knows. A row written by a
 *  newer build (an adapter since removed) must not draw a mark that has no art
 *  and no name. */
export function knownHarness(value: string | undefined, ids: readonly HarnessId[]): HarnessId | undefined {
  return value && (ids as readonly string[]).includes(value) ? (value as HarnessId) : undefined;
}
