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

import { getDb } from '@kabmo-labs/kabmo-db/lifecycle';
import type { HarnessId } from '@kabmo-labs/kabmo-harness/catalog';

export interface HarnessSessionRecord {
  sessionId: string;
  harness: string;
  /** The id the AGENT reported, when it differs from Kabmo's. */
  agentSessionId: string;
  cwd: string;
  /** The saved account whose home spawned this chat; '' for the host login. */
  accountId?: string;
  /** '' for a chat Kabmo spawned; 'imported' for one copied from the agent's
   *  own history. Optional on INPUT (a spawn writes no marker). */
  origin?: string;
}

/** Record which harness owns a session. Idempotent: a re-spawn of the same id
 *  UPDATES the row rather than failing on the primary key. */
export async function saveHarnessSession(record: HarnessSessionRecord): Promise<void> {
  const now = Date.now();
  const db = await getDb();
  await db.run(
    `INSERT INTO harness_sessions (session_id, harness, agent_session_id, cwd, account_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       harness = excluded.harness,
       agent_session_id = excluded.agent_session_id,
       cwd = excluded.cwd,
       account_id = excluded.account_id,
       updated_at = excluded.updated_at`,
    [record.sessionId, record.harness, record.agentSessionId, record.cwd, record.accountId ?? '', now, now],
  );
}

/**
 * Copy one session an agent reported into the index the sidebar reads.
 *
 * `DO NOTHING` on a known id, and never a bump of `updated_at`: an import is a
 * DISCOVERY, and re-running it must not reorder a chat Kabmo already lists (or
 * overwrite a title its own first prompt wrote). The agent-side dedupe
 * (`agent_session_id`) is checked by the caller, because a chat that was
 * resumed and forked keeps Kabmo's id in `session_id`.
 *
 * Returns whether a row was inserted, so the result can say `imported` versus
 * `known` instead of reporting a no-op as success.
 */
export async function importHarnessSession(record: {
  sessionId: string;
  harness: string;
  agentSessionId: string;
  cwd: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}): Promise<boolean> {
  const db = await getDb();
  const result = await db.run(
    `INSERT INTO harness_sessions
       (session_id, harness, agent_session_id, cwd, title, origin, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'imported', ?, ?)
     ON CONFLICT(session_id) DO NOTHING`,
    [
      record.sessionId,
      record.harness,
      record.agentSessionId,
      record.cwd,
      record.title,
      record.createdAt,
      record.updatedAt,
    ],
  );
  return (result.changes ?? 0) > 0;
}

/**
 * Whether this database already lists a session, by EITHER id.
 *
 * A resumed chat whose load forked keeps Kabmo's id in `session_id` and the
 * agent's in `agent_session_id`; an import that checked only `session_id`
 * inserted a second row for the same conversation (measured).
 */
export async function harnessSessionKnown(sessionId: string): Promise<boolean> {
  if (!sessionId) return false;
  const db = await getDb();
  const row = await db.get(
    `SELECT 1 AS present FROM harness_sessions
      WHERE session_id = ? OR (agent_session_id <> '' AND agent_session_id = ?)
      LIMIT 1`,
    [sessionId, sessionId],
  );
  return row != null;
}

/**
 * Name a chat from its first prompt, and only if nothing named it yet.
 *
 * `IfEmpty` is the whole reason a steering message, a queue delivery or a retry
 * cannot rename a chat to its own text: every prompt on an ACP session goes
 * through the same call. Returns whether the row CHANGED, so the caller can
 * publish the sidebar's structure once instead of on every prompt.
 */
export async function saveHarnessSessionTitleIfEmpty(sessionId: string, title: string): Promise<boolean> {
  if (!sessionId || !title) return false;
  const db = await getDb();
  const result = await db.run(
    `UPDATE harness_sessions SET title = ?, updated_at = ?
      WHERE session_id = ? AND (title IS NULL OR title = '')`,
    [title, Date.now(), sessionId],
  );
  return (result.changes ?? 0) > 0;
}

/**
 * Adopt a title the AGENT published.
 *
 * Unconditional, and that is the point: the agent's own name for the chat
 * outranks Kabmo's guess from the first prompt. The inequality guard keeps a
 * repeat of the same title (an agent may re-send it) from republishing the
 * sidebar's whole structure.
 */
export async function saveHarnessSessionTitle(sessionId: string, title: string): Promise<boolean> {
  if (!sessionId || !title) return false;
  const db = await getDb();
  const result = await db.run(
    `UPDATE harness_sessions SET title = ?, updated_at = ?
      WHERE session_id = ? AND (title IS NULL OR title <> ?)`,
    [title, Date.now(), sessionId, title],
  );
  return (result.changes ?? 0) > 0;
}

/**
 * Move a chat's record onto the id the agent RESUMED into.
 *
 * `session/load` may FORK: both claude and omp answered a NEW id for a load
 * (measured: `01a1b49f-…` → `01a1b4cc-…`, and a resumed claude chat answered
 * `340f24a3-…` for `5c5e776e-…`). `startAcpSession` records whatever id came
 * back, so the fork left TWO rows for one conversation — the chat's own (which
 * the sidebar, the open tab and Kabmo's transcript are all keyed by) plus an
 * empty twin. The chat keeps its id and adopts the agent's, because that is the
 * id the next `session/load` must send.
 */
export async function repointHarnessSession(sessionId: string, agentSessionId: string): Promise<void> {
  if (!sessionId || !agentSessionId || sessionId === agentSessionId) return;
  const db = await getDb();
  await db.run('DELETE FROM harness_sessions WHERE session_id = ?', [agentSessionId]);
  await db.run('UPDATE harness_sessions SET agent_session_id = ?, updated_at = ? WHERE session_id = ?', [
    agentSessionId,
    Date.now(),
    sessionId,
  ]);
}

export interface HarnessSessionRow {
  sessionId: string;
  harness: string;
  agentSessionId: string;
  cwd: string;
  /** See {@link HarnessSessionRecord.origin}. */
  origin: string;
  /** See {@link HarnessSessionRecord.accountId}. */
  accountId: string;
  /** What the chat is called: the agent's own title, else the first prompt.
   *  Empty when neither exists yet. */
  title: string;
  createdAt: number;
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
    `SELECT session_id, harness, agent_session_id, cwd, account_id, title, origin, created_at, updated_at
       FROM harness_sessions
      WHERE harness <> 'omp-rpc'
      ORDER BY updated_at DESC`,
  )) as {
    session_id: string;
    harness: string;
    agent_session_id: string;
    cwd: string;
    account_id: string | null;
    title: string | null;
    origin: string | null;
    created_at: number;
    updated_at: number;
  }[];
  return rows.map((row) => ({
    sessionId: row.session_id,
    harness: row.harness,
    agentSessionId: row.agent_session_id,
    cwd: row.cwd,
    accountId: row.account_id ?? '',
    title: row.title ?? '',
    origin: row.origin ?? '',
    createdAt: row.created_at,
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

/** The stored name of a session, or '' when it has none yet. */
export async function loadHarnessSessionTitle(sessionId: string): Promise<string> {
  const db = await getDb();
  const row = (await db.get('SELECT title FROM harness_sessions WHERE session_id = ?', [sessionId])) as {
    title: string | null;
  } | null;
  return row?.title ?? '';
}

/** The row for one session, or null. */
export async function loadHarnessSession(sessionId: string): Promise<HarnessSessionRecord | null> {
  const db = await getDb();
  const row = (await db.get(
    'SELECT session_id, harness, agent_session_id, cwd, account_id, origin FROM harness_sessions WHERE session_id = ?',
    [sessionId],
  )) as {
    session_id: string;
    harness: string;
    agent_session_id: string;
    cwd: string;
    account_id: string | null;
    origin: string | null;
  } | null;
  if (!row) return null;
  return {
    sessionId: row.session_id,
    harness: row.harness,
    agentSessionId: row.agent_session_id,
    cwd: row.cwd,
    accountId: row.account_id ?? '',
    origin: row.origin ?? '',
  };
}

/** The shape every harness id has, built-in or user-added. */
const HARNESS_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

/**
 * Narrow a stored value to a harness id.
 *
 * A built-in is accepted by the caller's list; a WELL-FORMED id is accepted even
 * when this process has no descriptor for it, because that is exactly the case a
 * user-added harness produces after a restart (the registry loads asynchronously)
 * and the case a REMOVED one produces forever. Dropping it would rewrite the
 * chat's harness to `omp-rpc` — a wrong mark and a resume against the wrong
 * agent. A malformed value is still refused.
 */
export function knownHarness(value: string | undefined, ids: readonly HarnessId[]): HarnessId | undefined {
  if (!value) return undefined;
  if ((ids as readonly string[]).includes(value)) return value as HarnessId;
  return HARNESS_ID_PATTERN.test(value) ? (value as HarnessId) : undefined;
}
