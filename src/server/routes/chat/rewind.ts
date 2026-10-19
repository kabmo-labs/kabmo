import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs } from '@/server/lib/remix-compat';
import { getDb } from '@/server/db.server';
import { resolveSessionFileOr404 } from '@/server/lib/omp/session/locator';
import { getRpcSession } from '@/server/lib/omp/rpc/session-registry';
import { clearSessionFileCaches } from '@/server/lib/omp/session/files';
import { pruneStoredAfterCut, survivingUserTexts, truncateSessionBody } from '@/server/lib/omp/session/rewind-file';
import { userTurnsRelate } from '@/shared/lib/chat/timeline/turns';

/**
 * In-place rewind (undo) for an omp session: truncate the session JSONL back
 * to just before a user turn and clean the Kabmo DB overlay copy.
 *
 * Why file surgery instead of omp's `branch` RPC: branch always forks a new
 * session file (new id → URL/sidebar churn). omp itself rewrites this same
 * file in place for equivalent operations (`rewriteEntries`), and its JSONL
 * readers walk entries in order, so a prefix-preserving truncation is faithful.
 *
 * Safety contract:
 *  - the live omp process for this session is destroyed first (it flushes all
 *    pending state on shutdown and is the only other writer of this file);
 *  - the original file is kept as `<name>.bak-<timestamp>` (omp's session
 *    listing ignores names containing `.bak`, so it never becomes a phantom
 *    session).
 *
 * Which records are valid cut points is `rewind-file.ts` (a plain prompt, or
 * the `skill-prompt` custom record omp writes instead of one).
 */

interface StoredMessage {
  role?: string;
  content?: string;
  id?: string;
}

export async function action({ params, request }: ActionFunctionArgs) {
  const { sessionId } = params;
  if (!sessionId) return json({ error: 'session id is required' }, { status: 400 });
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, { status: 405 });

  const body: unknown = await request.json().catch(() => null);
  const entryId = body && typeof body === 'object' && 'entryId' in body && typeof body.entryId === 'string'
    ? body.entryId
    : '';
  if (!entryId) return json({ error: 'entryId is required', code: 'entry_id_required' }, { status: 400 });
  // The row's own clock, sent by the client for a turn the session FILE does
  // not carry: a builtin command (`/usage`, `/compact`) writes no entry, so its
  // timeline row exists only in Kabmo overlay and its id is client-side.
  const startedAt = body && typeof body === 'object' && 'startedAt' in body && typeof body.startedAt === 'number'
    ? body.startedAt
    : undefined;

  const resolved = await resolveSessionFileOr404(sessionId);
  if ('response' in resolved) return resolved.response;
  const { filePath } = resolved;

  // Tear down the live process first: it flushes pending writes on shutdown
  // and must not race the rewrite. Best-effort — the session may already be
  // gone or mid-restart.
  const live = getRpcSession(sessionId);
  if (live?.isAlive()) {
    await live.destroyAndWait();
  }
  clearSessionFileCaches();

  const raw = await Bun.file(filePath).text();
  const truncated = truncateSessionBody(raw, { entryId, startedAt });
  if (truncated === null) {
    return json({ error: 'Entry not found or not a user turn in this session', code: 'entry_not_found' }, { status: 400 });
  }
  const { body: nextBody, overlayCutClock, droppedEntryIds } = truncated;

  // Backup then rewrite. `.bak` names are skipped by omp's session listing.
  const backupPath = `${filePath}.bak-${Date.now()}`;
  await Bun.write(backupPath, raw);
  try {
    await Bun.write(filePath, nextBody);
  } catch (error) {
    await Bun.write(filePath, raw);
    return json({ error: error instanceof Error ? error.message : 'Failed to rewrite session file' }, { status: 500 });
  }

  // Clean the Kabmo DB overlay: a stored turn the cut removed would otherwise
  // be merged straight back onto the truncated file on the next load — which is
  // exactly what made an undone turn reappear after a reload.
  try {
    const db = await getDb();
    const row = await db.get('SELECT title, messages FROM chat_sessions WHERE session_id = ?', [sessionId]);
    if (row?.messages) {
      let stored: StoredMessage[] = [];
      try {
        stored = JSON.parse(row.messages) as StoredMessage[];
      } catch {
        stored = [];
      }
      const next = pruneStoredAfterCut(stored, {
        requestedId: entryId,
        droppedEntryIds,
        cutClock: overlayCutClock,
        keptUserTexts: survivingUserTexts(nextBody),
        relates: userTurnsRelate,
      });
      if (next.length !== stored.length) {
        await db.run(
          'INSERT OR REPLACE INTO chat_sessions (session_id, title, messages, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
          [sessionId, row.title ?? null, JSON.stringify(next)],
        );
      }
    }
  } catch {
    // Overlay cleanup is best-effort; the JSONL is authoritative for reloads.
  }

  clearSessionFileCaches();
  return json({ success: true });
}
