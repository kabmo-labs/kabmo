/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The subagent-presence verdict, saved so a restart does not re-derive it.
 *
 * Presence is a fact about a FILE VERSION, not about a live process: the
 * verdict only changes when the session gains entries or its sibling artifacts
 * directory changes, and both are already encoded in the key. Deriving it
 * means streaming the whole parent transcript, measured at 1.38 GB of reads on
 * a 1349-file agent directory — the reason a freshly restarted server held
 * ~900 MB of resident-set in freed arena after the console's sidebar load.
 * An in-process map cannot survive the restart that pays that cost, so the one
 * verdict the next boot would otherwise recompute lives in the database it
 * already opens for the same request (AGENTS.md §6: anything that must survive
 * a reload is server-side state).
 *
 * Two rules keep this safe for callers that are not the sidebar:
 *
 * 1. **It never opens a database.** `getDbSync()` answers the handle already
 *    open, and a probe that runs before `getDb()` (or in a test that has no
 *    database) simply misses the cache. Opening one here would make a badge
 *    read create a file and would leak the developer's real store into a test.
 * 2. **A failure is a miss.** A read or write that throws costs one rescan; it
 *    must never fail the sidebar.
 *
 * Rows for sessions deleted long ago are not pruned: they are a hundred bytes
 * each, they are never read (no file list entry names them), and a delete pass
 * would be a write on the hot path of every boot.
 */

import { getDbSync } from '@/server/db.server';

/** The saved verdict for this exact file version, or null when unknown. */
export async function readPresenceVerdict(sessionPath: string, version: string): Promise<boolean | null> {
  try {
    const row = await getDbSync().get<{ has_subagents: number }>(
      'SELECT has_subagents FROM session_subagent_presence WHERE session_path = ? AND version = ?',
      [sessionPath, version],
    );
    if (!row) return null;
    return row.has_subagents === 1;
  } catch {
    return null;
  }
}

/** Replace the saved verdict for a session. Best-effort by contract. */
export async function writePresenceVerdict(sessionPath: string, version: string, hasSubagents: boolean): Promise<void> {
  try {
    await getDbSync().run(
      `INSERT INTO session_subagent_presence (session_path, version, has_subagents, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(session_path) DO UPDATE SET
         version = excluded.version,
         has_subagents = excluded.has_subagents,
         updated_at = excluded.updated_at`,
      [sessionPath, version, hasSubagents ? 1 : 0, Date.now()],
    );
  } catch {
    // A miss here is one rescan on the next start, never a failed sidebar.
  }
}