/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * POST /api/sessions/batch-archive — archive several sessions in one request.
 *
 * The sidebar's session batch mode is one user action over N rows, so it is one
 * request: a client loop would pay N round trips and republish the sidebar N
 * times for a single click.
 *
 * Archiving is the reversible sibling of delete — the row moves between the
 * sidebar's archive view and its normal list, and the transcript is untouched
 * (see `archiveSession`). It therefore needs no busy-child check and no
 * destructive confirmation; the only refusals are the two "this id names
 * something other than a real session" cases the single verbs already share:
 * a pending `new-…` chat (there is no transcript to archive yet) and an id that
 * is not one path segment.
 *
 * A refusal is a verdict, never an abort: a batch holding one pending chat
 * still archives the rest, and the caller is told which ids survived and why.
 */

import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed, parseJsonBody } from '@/server/lib/route-adapter';
import { getDb } from '@/server/db.server';
import { isSinglePathSegment } from '@/server/lib/fs/path-segment';
import { emitRealtimeSignal } from '@/server/lib/realtime/signals.server';

/** One request cannot carry an unbounded selection. */
const MAX_BATCH = 500;

export async function batchArchiveSessions({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return methodNotAllowed({ request, params: {} });
  }

  const parsed = await parseJsonBody<{ ids?: unknown }>(request);
  if (!parsed.ok) return json({ error: 'Invalid JSON body' }, { status: 400 });

  const raw = parsed.body.ids;
  if (!Array.isArray(raw) || raw.some((id) => typeof id !== 'string' || id.length === 0)) {
    return json({ error: 'ids must be an array of session ids' }, { status: 400 });
  }
  const ids = [...new Set(raw as string[])];
  if (ids.length === 0) return json({ error: 'No sessions selected' }, { status: 400 });
  if (ids.length > MAX_BATCH) {
    return json({ error: `At most ${MAX_BATCH} sessions can be archived at once.` }, { status: 400 });
  }

  const db = await getDb();
  const archived: string[] = [];
  const refused: { id: string; error: string; code?: string }[] = [];

  for (const id of ids) {
    // The same two "names something other than the session it appears to"
    // refusals the single verbs use: a pending chat has no transcript, and an
    // id that is not one path segment cannot name a session.
    if (id.startsWith('new-')) {
      refused.push({ id, error: 'This chat has not been created yet.', code: 'session_pending' });
      continue;
    }
    if (!isSinglePathSegment(id)) {
      refused.push({ id, error: 'Invalid session id', code: 'invalid_id' });
      continue;
    }
    // Idempotent: `session_id` is the primary key, so a session already
    // archived stays archived and the row is not duplicated.
    await db.run('INSERT OR IGNORE INTO archived_sessions (session_id) VALUES (?)', [id]);
    archived.push(id);
  }

  // Archiving moves sessions between the sidebar's archive view and its normal
  // list, so the structure changed — one republish covers the whole batch.
  if (archived.length > 0) emitRealtimeSignal('sidebar-structure');

  return json({ success: refused.length === 0, archived, refused });
}
