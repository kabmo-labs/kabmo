/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The session a native shell resumes on a cold start — PER CLIENT.
 *
 * The shells load the console's origin with no query, and the console used to
 * answer that with its empty workspace. "The session I had open" is a fact the
 * URL cannot carry across a relaunch — the shell stores no session id of its
 * own — so the server keeps it.
 *
 * The grain is the CLIENT, not the server. A console is one database but not
 * one device: the phone shell, the desktop shell and a browser tab can all
 * point at the same instance, and a single shared row made each of them
 * overwrite the others (open a chat on the desktop, and the phone restored it on
 * its next launch). `client_id` comes from the `kabmo_client` cookie
 * (`last-opened-client.server.ts`), whose jar is per WebView data store — the
 * same boundary the user sees as "this app".
 *
 * ## What is recorded
 *
 * Every session a shell's URL selects. A browser records too (its cookie names
 * its own row), but only a shell restores: the record is the fact a relaunch
 * needs, not a browser navigation rule.
 *
 * ## What is NOT recorded
 *
 * Pending ids (`new-…`, `__new__…`). They name a chat that has not been spawned
 * and may never be; restoring one would relaunch into a placeholder that no
 * longer exists. The spawn adoption writes the real id through the same path,
 * so the open is not lost — only deferred until it is a real session.
 *
 * ## Why the record is validated on read
 *
 * A shell restores before anyone can press anything, so a stale id is a launch
 * into a 404. The read therefore answers `null` — and clears the row — for an
 * id that is deleted, archived, or no longer present. Already-deleted sessions
 * also lose their record at delete time; this check is the backstop for the
 * paths that remove a session without going through that route (an omp
 * transcript removed by hand, another instance, a restored backup).
 */

import { isMockMode } from '@kabmo-labs/kabmo-runtime-flags';
import { isSinglePathSegment } from '@kabmo-labs/kabmo-paths/path-segment';
import { getDb } from '@/server/db.server';
import { isSessionArchived, sessionExists } from '@/server/lib/sessions/resolve.server';

/** The stored id for one client, or null when there is none. */
export async function readLastOpenedSessionId(clientId: string): Promise<string | null> {
  if (!clientId) return null;
  const db = await getDb();
  const row = await db.get<{ session_id?: string }>(
    'SELECT session_id FROM last_opened_sessions WHERE client_id = ?',
    [clientId],
  );
  const value = row?.session_id?.trim();
  return value ? value : null;
}

/**
 * Persist `sessionId` as this client's last opened session.
 *
 * Returns false for an id that is not a recordable session: a placeholder, a
 * value that is not one path segment, or a no-op rewrite of the current row. A
 * caller reports the refusal rather than pretending the write happened.
 */
export async function recordLastOpenedSession(clientId: string, sessionId: string): Promise<boolean> {
  if (!clientId) return false;
  if (!isSinglePathSegment(sessionId)) return false;
  // A pending chat (`new-…`, `__new__…`) has no session to reopen yet; the
  // spawn adoption sends the real id through this same call.
  if (sessionId.startsWith('new-') || sessionId.startsWith('__new__')) return false;
  if ((await readLastOpenedSessionId(clientId)) === sessionId) return true;

  const db = await getDb();
  await db.run(
    `INSERT OR REPLACE INTO last_opened_sessions (client_id, session_id, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)`,
    [clientId, sessionId],
  );
  return true;
}

/** Drop this client's record, so its next cold start lands on the empty workspace. */
export async function clearLastOpenedSession(clientId: string): Promise<void> {
  if (!clientId) return;
  const db = await getDb();
  await db.run('DELETE FROM last_opened_sessions WHERE client_id = ?', [clientId]);
}

/**
 * Whether a session id can still be opened: present, not archived, not
 * tombstoned. Mock rows live in `sessions`; a real session is live, recorded in
 * `harness_sessions`, or has a transcript on disk.
 */
async function sessionCanOpen(sessionId: string): Promise<boolean> {
  const db = await getDb();
  const deleted = await db.get(
    'SELECT 1 AS present FROM deleted_sessions WHERE session_id = ?',
    [sessionId],
  );
  if (deleted) return false;
  if (await isSessionArchived(sessionId)) return false;

  if (isMockMode()) {
    const row = await db.get('SELECT 1 AS present FROM sessions WHERE CAST(id AS TEXT) = ?', [
      sessionId,
    ]);
    return row != null;
  }

  return sessionExists(sessionId);
}

/**
 * The session this client should restore, or null.
 *
 * A stale record is DELETED, not merely skipped: every later launch would
 * otherwise repeat the same check for a session that can never come back.
 */
export async function lastOpenedSession(clientId: string): Promise<string | null> {
  const sessionId = await readLastOpenedSessionId(clientId);
  if (!sessionId) return null;
  if (await sessionCanOpen(sessionId)) return sessionId;
  await clearLastOpenedSession(clientId);
  return null;
}
