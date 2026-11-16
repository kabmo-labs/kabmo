/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Remove a session's Kabmo change journal.
 *
 * The journal is derived data, but it holds file contents: leaving it behind
 * after a delete would keep a copy of every file the run touched, under an id
 * the sidebar no longer lists. The directory is the unit — `changes.jsonl`,
 * its rotated siblings and `blobs/` all live under it.
 */

import { rm } from 'node:fs/promises';
import { sessionChangesDir } from '@/server/lib/changes/paths.server';

/** True when a journal directory existed and was removed. */
export async function purgeChangeJournal(sessionId: string): Promise<boolean> {
  let dir: string;
  try {
    dir = sessionChangesDir(sessionId);
  } catch {
    return false;
  }
  try {
    await rm(dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
