/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Boot-time repair of the `chat_sessions` overlay.
 *
 * The overlay used to be a full mirror of every conversation: the chat timeline
 * posted its whole rendered message list on every `message_end`, so each stored
 * row carried a copy of the transcript omp already owns in the session JSONL.
 * `overlayRowsForOmpSession` narrows what is written from now on, and this pass
 * applies the same rule to rows written before it existed — measured on the
 * author's install, 165.6 MB of 167.9 MB of mirrored rows were assistant
 * messages no reader ever touches.
 *
 * It has NO marker, deliberately, and that is the difference from the
 * `queue_fk_removed` migration: the guard here is per-row ("does the filter
 * actually shrink this row?"), which makes the pass self-limiting rather than
 * once-only. A marker would be set after the first clean pass and then leave
 * every row written by an older build uncompacted for good — a live server has
 * to be restarted for the narrowed writer to take effect, and it keeps writing
 * mirrors until it is.
 *
 * Two properties keep it safe on an existing database:
 *
 * - It only rewrites a row whose session file EXISTS. For a Kabmo-created
 *   session the DB is the only copy, so those rows are left exactly as they are.
 * - It only rewrites a row it actually shrinks, so the cost is proportional to
 *   what is left to fix: 762 ms for a 173 MB overlay on first run, and one
 *   parse-and-skip of the remaining ~5 MB on every later start.
 *
 * A failure is logged rather than thrown: it must never be able to stop the
 * server from starting. It is called from the server bootstrap right after the
 * "listening" banner and deliberately NOT from `getDb()` — the test suite and
 * the CLI reach that in real mode, so a database HANDLE would be able to launch
 * the rewrite (verified the hard way: a `bun test` run compacted a live
 * database).
 */

import type { DbClient } from '@/server/lib/db/client';
import { findSessionFileById } from '@/server/lib/omp/session/locator';
import { overlayRowsForOmpSession } from '@/server/lib/omp/session/merge-stored';

/**
 * Rewrite every over-full `chat_sessions` row whose transcript omp owns.
 *
 * `sessionsRoot` is the locator's own seam, forwarded so a test can point the
 * file lookup at its own tree instead of the real agent directory.
 */
export async function compactChatOverlayRows(db: DbClient, sessionsRoot?: string): Promise<void> {
  try {
    const rows = (await db.all('SELECT session_id, messages FROM chat_sessions')) as {
      session_id: string;
      messages: string;
    }[];

    let compacted = 0;
    let reclaimed = 0;
    for (const row of rows) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.messages);
      } catch {
        // Unparseable is not ours to fix: the readers already treat it as empty.
        continue;
      }
      if (!Array.isArray(parsed) || parsed.length === 0) continue;

      const reduced = overlayRowsForOmpSession(parsed);
      // The filter only ever removes, so an unchanged length means nothing to do
      // — and the file lookup below is the expensive half, so it comes second.
      if (reduced.length === parsed.length) continue;
      if (!(await findSessionFileById(row.session_id, sessionsRoot))) continue;

      const next = JSON.stringify(reduced);
      await db.run('UPDATE chat_sessions SET messages = ? WHERE session_id = ?', [next, row.session_id]);
      compacted += 1;
      reclaimed += row.messages.length - next.length;
    }

    if (compacted > 0) {
      console.log(
        `[chat-overlay] compacted ${compacted} mirrored session row(s), reclaimed ${(reclaimed / 1e6).toFixed(1)} MB`,
      );
    }
  } catch (error) {
    console.warn('[chat-overlay] compaction failed; will retry on next start:', error);
  }
}
