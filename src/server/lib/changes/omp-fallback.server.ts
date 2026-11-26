/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The omp journal as a fallback for a raced `write` snapshot.
 *
 * omp records `write`/`edit` before/after blobs itself, and it reads the file
 * inside the tool — before the write — so its `before` is exact where Kabmo's
 * start-frame snapshot can lose the race. When a `write`'s before and after are
 * equal, the capture asks this module for the omp record of the same path near
 * the call's start time and reads its `before` blob.
 *
 * A missing record answers `undefined` (unknown), not `null` (absent): the
 * caller must not turn "I could not find it" into "the file did not exist".
 */

import path from 'node:path';
import { readBlob } from '@/server/lib/changes/blobs.server';
import { readSessionChangeIndex } from '@kabmo-labs/kabmo-omp-session-changes/changes';
import { findSessionFileById } from '@kabmo-labs/kabmo-omp-session-locator';
import { siblingDirForSession } from '@kabmo-labs/kabmo-omp-subagent/history-paths';

/** How far the omp record's write time may sit from the call's start frame. */
const MATCH_WINDOW_MS = 10_000;

export async function readOmpBefore(
  sessionId: string,
  absolute: string,
  at: number,
): Promise<string | null | undefined> {
  const records = await readSessionChangeIndex(sessionId);
  let best: { before: string | null | undefined; delta: number } | null = null;
  for (const record of records) {
    if (record.path !== absolute) continue;
    if (record.before === undefined) continue;
    const delta = Math.abs(record.at - at);
    if (delta > MATCH_WINDOW_MS) continue;
    if (!best || delta < best.delta) best = { before: record.before, delta };
  }
  if (!best) return undefined;
  if (best.before === null) return null;

  const sessionFile = await findSessionFileById(sessionId);
  if (!sessionFile) return undefined;
  return readBlob(path.join(siblingDirForSession(sessionFile), 'blobs'), best.before);
}
