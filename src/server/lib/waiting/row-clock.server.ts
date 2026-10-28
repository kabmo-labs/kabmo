/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * When was a session's stream row last written?
 *
 * The dependency check needs this and the SIDEBAR does not, which is why it is
 * a query of its own rather than a field on `SessionStreamState`: that payload
 * is the `sidebar:status` wire contract, and widening it for one caller would
 * put a field on every frame that no consumer reads.
 *
 * The conversion happens in SQLite. `updated_at` is written by
 * `CURRENT_TIMESTAMP` — a UTC string with no zone marker — so parsing it in JS
 * would silently read it as local time. `strftime('%s', …)` yields epoch
 * seconds, which is the resolution the row is written at.
 */

import { getDb } from '@/server/db.server';

/**
 * Epoch ms of the session's last stream-status write, or null when the session
 * has no row (or the clock cannot be read).
 */
export async function streamRowWrittenAt(sessionId: string): Promise<number | null> {
  try {
    const db = await getDb();
    const row = (await db.get(
      "SELECT CAST(strftime('%s', updated_at) AS INTEGER) AS epoch FROM session_stream_state WHERE session_id = ?",
      [sessionId],
    )) as { epoch?: number | null } | undefined;
    return typeof row?.epoch === 'number' ? row.epoch * 1000 : null;
  } catch {
    return null;
  }
}
