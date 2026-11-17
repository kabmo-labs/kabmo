/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `write` race: the start-frame snapshot read the file AFTER the tool wrote
 * it, so `before === after` and the change would be dropped.
 *
 * omp reads the file inside the tool, before the write, so its journal's
 * `before` blob is exact. When it has no record (an ACP agent, or a build that
 * does not journal), the file's birth time decides: a file born after the call
 * started was created by this write (`before: null`, an A), and an older file
 * is a rewrite whose before is unknown (`before: undefined`, an M with a
 * `snapshot-race` note).
 */

import type { PendingCall } from '@/server/lib/changes/capture-types';
import { readOmpBefore } from '@/server/lib/changes/omp-fallback.server';

/** The before side of an `edit` whose write landed before the snapshot. */
export function reconstructEdit(pending: PendingCall, after: string | null | undefined): string | null {
  if (after === null || after === undefined) return null;
  const oldString = pending.args.old_string ?? pending.args.oldString;
  const newString = pending.args.new_string ?? pending.args.newString;
  if (typeof oldString !== 'string' || typeof newString !== 'string' || !newString) return null;
  if (!after.includes(newString)) return null;
  return after.replace(newString, oldString);
}

export interface RacedWrite {
  before: string | null | undefined;
  reason?: 'snapshot-race';
}

export async function resolveRacedWrite(
  pending: PendingCall,
  absolute: string,
  deps: {
    sessionId: string;
    statFile: (path: string) => Promise<{ birthtimeMs: number } | null>;
  },
): Promise<RacedWrite> {
  const ompBefore = await readOmpBefore(deps.sessionId, absolute, pending.startedAt);
  if (ompBefore !== undefined) return { before: ompBefore };

  const info = await deps.statFile(absolute);
  const created = info !== null && info.birthtimeMs >= pending.startedAt;
  return created ? { before: null } : { before: undefined, reason: 'snapshot-race' };
}
