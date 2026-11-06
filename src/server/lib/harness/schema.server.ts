/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which harness owns a session, persisted.
 *
 * The live registry (`registry.ts`) answers this for a session THIS process is
 * running, in a `WeakMap` keyed by the session object. That is the right answer
 * for "is it live" and the wrong one for "which agent produced this chat": a
 * closed tab, a restart, or a second Kabmo instance on the same database all lose
 * the map, and the sidebar then has nothing to draw.
 *
 * So a spawn writes one row here, and the sidebar reads it. Without it EVERY row
 * was reported as `omp-rpc` (`sidebar-data.server.ts` filled the field from
 * `DEFAULT_HARNESS_ID`), which is indistinguishable from "not tracked" — the
 * mark beside a session name told the reader `omp` no matter which agent ran it.
 *
 * The agent's own session id is stored beside ours because ACP can answer a
 * DIFFERENT id than the one asked for (a `session/load` that forks), and resuming
 * a chat has to send the AGENT's id, not Kabmo's.
 */

import type { DbClient } from '@/server/lib/db/client';

const HARNESS_SESSIONS_SQL = `
  CREATE TABLE IF NOT EXISTS harness_sessions (
    session_id TEXT PRIMARY KEY,
    harness TEXT NOT NULL,
    -- The id the AGENT reported. Empty for omp's RPC sessions, whose id is
    -- Kabmo's own (omp generates it and both sides use it).
    agent_session_id TEXT NOT NULL DEFAULT '',
    cwd TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_harness_sessions_harness
    ON harness_sessions (harness);
`;

/**
 * What each agent reported, persisted.
 *
 * The probe cache lived only in memory for the process lifetime, so EVERY server
 * restart — including a `bun --hot` reload — emptied it and every harness went
 * back to `not probed` even though the user had pressed Check status a minute
 * earlier. The answer is a property of the INSTALLED BINARY, not of the process,
 * so it belongs on disk; `probed_at` is what keeps the TTL meaningful (the file
 * it describes can still change under an update).
 *
 * One row per harness: a probe REPLACES the previous one, and the whole payload
 * is a single JSON document because nothing queries into it.
 */
const HARNESS_PROBES_SQL = `
  CREATE TABLE IF NOT EXISTS harness_probes (
    harness TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    probed_at INTEGER NOT NULL
  );
`;

/** Idempotent: created on every database open, like every other feature table. */
export async function ensureHarnessSchema(db: DbClient): Promise<void> {
  await db.exec(HARNESS_SESSIONS_SQL);
  await db.exec(HARNESS_PROBES_SQL);
}
