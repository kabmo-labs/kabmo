/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What a session id means, independent of transport.
 *
 * A session may be live in this process, recorded in `harness_sessions` (a chat
 * this process has closed), or an omp transcript on disk (a chat this process
 * never saw). Spawning a child, notifying a parent and forking all need the same
 * three answers — harness, cwd, agent id — and resolving them in three modules
 * is how the sidebar and the routes drift apart.
 */

import { getLiveSession, harnessOfSession } from '@/server/lib/omp/rpc/session-registry';
import { findSessionFileById } from '@/server/lib/omp/session/locator';
import { readRawHeaderLine } from '@/server/lib/omp/session/files';
import { knownHarness, loadHarnessSession } from '@/server/lib/harness/session-store.server';
import { canonicalPath } from '@/server/lib/fs/canonical';
import { resolveProjectRoot } from '@/server/lib/omp/core/worktree';
import { getDb } from '@/server/db.server';
import { HARNESS_IDS, type HarnessId } from '@/shared/lib/harness/catalog';

export interface SessionRef {
  sessionId: string;
  /** Null when nothing in this build can name the transport. */
  harness: HarnessId | null;
  cwd: string | null;
  /** The agent's own id, for `session/load`; empty for omp. */
  agentSessionId: string;
  live: boolean;
}

/** Resolve harness, cwd and agent id for one session id. */
export async function resolveSessionRef(sessionId: string): Promise<SessionRef> {
  const live = getLiveSession(sessionId);
  if (live?.isAlive()) {
    const harness = harnessOfSession(live);
    return {
      sessionId,
      harness,
      cwd: live.cwd || null,
      agentSessionId: harness === 'omp-rpc' ? '' : live.sessionId,
      live: true,
    };
  }

  const record = await loadHarnessSession(sessionId);
  const filePath = await findSessionFileById(sessionId);
  const header = filePath ? await readRawHeaderLine(filePath) : null;
  const headerCwd = typeof header?.cwd === 'string' ? header.cwd : null;
  const recordedHarness = knownHarness(record?.harness, HARNESS_IDS);
  return {
    sessionId,
    harness: recordedHarness ?? (filePath ? 'omp-rpc' : null),
    cwd: record?.cwd || headerCwd || null,
    agentSessionId: record?.agentSessionId || '',
    live: false,
  };
}

/** True when a session has a transcript or a harness record. */
export async function sessionExists(sessionId: string): Promise<boolean> {
  if (getLiveSession(sessionId)?.isAlive()) return true;
  if (await loadHarnessSession(sessionId)) return true;
  return (await findSessionFileById(sessionId)) !== undefined;
}

/** True when the sidebar has archived the session. */
export async function isSessionArchived(sessionId: string): Promise<boolean> {
  const db = await getDb();
  const row = await db.get('SELECT 1 AS present FROM archived_sessions WHERE session_id = ?', [
    sessionId,
  ]);
  return row != null;
}

/**
 * The workspace folder a cwd belongs to, or null.
 *
 * Same resolution the sidebar uses: the cwd's project root, canonicalised,
 * compared against each folder's registered path. A cwd outside every folder
 * answers null rather than being filed under the first one.
 */
export async function folderIdForCwd(cwd: string | null): Promise<number | null> {
  if (!cwd) return null;
  const root = await resolveProjectRoot(cwd).catch(() => '');
  if (!root) return null;
  const rootKey = await canonicalPath(root);
  const db = await getDb();
  const folders = await db.all<{ id: number; project_path: string | null }>(
    'SELECT id, project_path FROM workspace_folders',
  );
  for (const folder of folders) {
    if (!folder.project_path) continue;
    if ((await canonicalPath(folder.project_path)) === rootKey) return folder.id;
  }
  return null;
}

/** The folder a session is filed under, or null when it has no cwd yet. */
export async function folderIdForSession(sessionId: string): Promise<number | null> {
  const ref = await resolveSessionRef(sessionId);
  return folderIdForCwd(ref.cwd);
}
