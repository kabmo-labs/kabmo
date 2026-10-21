/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Deleting a session: the transcript on disk, its subagent artifacts, and every
 * Kabmo-side row keyed to the session id.
 *
 * The transcript is authoritative — omp's own session listing is derived from
 * the JSONL alone — so a delete that removed only Kabmo's rows would see
 * the session come straight back on the next sidebar scan. What "delete" means
 * here, in one place:
 *
 *   - the session JSONL, plus any `<name>.jsonl.bak-*` copy an earlier rewind
 *     left beside it (a full copy of the same transcript: leaving it behind
 *     would mean the conversation was not actually deleted);
 *   - its sibling artifacts directory, which holds the subagent transcripts;
 *   - the `archived_sessions`, `session_ui_state`, `session_stream_state`,
 *     `queued_messages` and `chat_sessions` rows for that id;
 *   - in mock mode the demo `sessions` row and its `files` tree.
 *
 * The caller owns the process: a live omp child MUST be destroyed before this
 * runs, because omp flushes its session state on shutdown and would otherwise
 * recreate the file this just removed. Side-question rows and workspaces are
 * the btw module's business (`purgeBtwForSession`).
 */

import fs from 'fs';
import path from 'path';
import { getDb } from '@/server/db.server';
import type { DbClient } from '@/server/lib/db/client';
import { findSessionFileById } from '@/server/lib/omp/session/locator';
import { clearSessionFileCaches } from '@/server/lib/omp/session/files';
import { invalidateOmpSidebarData } from '@/server/lib/omp/session/reader';
import { emitRealtimeSignal } from '@/server/lib/realtime/signals.server';
import { failWaitingOn } from '@/server/lib/waiting/store.server';
import { siblingDirForSession } from '@/server/lib/omp/subagent/history/paths';
import { isSinglePathSegment } from '@/server/lib/fs/path-segment';

export interface SessionPurgeResult {
  /** Something keyed to this id existed — a transcript, a mock session row, or
   *  a Kabmo row. False means the id resolved nowhere at all. */
  found: boolean;
  fileRemoved: boolean;
  artifactsRemoved: boolean;
}

/**
 * Kabmo rows keyed by a session id. Every statement is a no-op when the id
 * matches nothing, which is what makes one purge serve both modes: real
 * sessions (omp UUIDs, present on disk only) and mock ones (numeric ids in
 * `sessions`).
 *
 * `files` carries a FOREIGN KEY to `sessions` and `foreign_keys` is ON, so its
 * children go before the session row or the delete is refused.
 */
const SESSION_ROW_DELETES: readonly (readonly [string, string])[] = [
  ['archived_sessions', 'session_id'],
  ['session_ui_state', 'session_id'],
  ['session_stream_state', 'session_id'],
  ['queued_messages', 'session_id'],
  ['chat_sessions', 'session_id'],
  ['files', 'session_id'],
];

async function purgeKabmoRows(db: DbClient, sessionId: string): Promise<number> {
  let changes = 0;
  for (const [table, column] of SESSION_ROW_DELETES) {
    const result = await db.run(`DELETE FROM ${table} WHERE ${column} = ?`, [sessionId]);
    changes += result.changes ?? 0;
  }
  const mockRow = await db.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
  return changes + (mockRow.changes ?? 0);
}

/** Remove the transcript and the `.bak-*` copies beside it. */
async function removeTranscript(filePath: string): Promise<boolean> {
  const existed = await Bun.file(filePath).exists();
  await fs.promises.rm(filePath, { force: true });
  const dir = path.dirname(filePath);
  const prefix = `${path.basename(filePath)}.bak-`;
  try {
    for (const entry of await fs.promises.readdir(dir)) {
      if (entry.startsWith(prefix)) await fs.promises.rm(path.join(dir, entry), { force: true });
    }
  } catch {
    // A backup that cannot be listed is not worth failing a delete the
    // transcript half of which already succeeded.
  }
  return existed;
}

/**
 * Purge everything Kabmo and the agent directory hold for `sessionId`.
 * `sessionId` must be a single safe path segment — it names the artifacts
 * directory — which the route validates before calling.
 */
export async function purgeSessionData(sessionId: string): Promise<SessionPurgeResult> {
  // Second gate, independent of the route's: an id that is not one segment
  // would make `siblingDirForSession` and the btw purge resolve outside the
  // session it names. Refusing here means a future caller that forgets the
  // route's guard still cannot widen the blast radius.
  if (!isSinglePathSegment(sessionId)) {
    return { found: false, fileRemoved: false, artifactsRemoved: false };
  }

  const filePath = await findSessionFileById(sessionId);
  let fileRemoved = false;
  let artifactsRemoved = false;
  if (filePath) {
    fileRemoved = await removeTranscript(filePath);
    const artifactsDir = siblingDirForSession(filePath);
    // `stat`, not `Bun.file().exists()`: the latter answers for regular files
    // only and reports a directory as absent, which would claim every session
    // had no subagent transcripts.
    artifactsRemoved = await fs.promises
      .stat(artifactsDir)
      .then((stats) => stats.isDirectory(), () => false);
    await fs.promises.rm(artifactsDir, { recursive: true, force: true });
  }

  const db = await getDb();
  const rowChanges = await purgeKabmoRows(db, sessionId);

  // A prompt waiting on this session will never be released: the dependency is
  // gone. Fail it BY NAME rather than letting it wait for a session that no
  // longer exists — and keep the row, because its error text is the only thing
  // that tells the user what happened to the prompt they wrote.
  const strandedPrompts = await failWaitingOn(sessionId, 'The session being waited for was deleted.');
  if (strandedPrompts > 0) emitRealtimeSignal('waiting-changed');

  // Both caches outlive the mutation by their own keys: the file list/scan pair
  // is mtime-keyed (a delete bumps the parent directory, but the memo can still
  // answer first) and the sidebar dataset is TTL'd, so without this the deleted
  // row is served back to the refresh that follows the delete.
  clearSessionFileCaches();
  invalidateOmpSidebarData();

  emitRealtimeSignal('sidebar-structure');

  return {
    found: Boolean(filePath) || rowChanges > 0,
    fileRemoved,
    artifactsRemoved,
  };
}
