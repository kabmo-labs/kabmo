/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The one session-removal sequence, shared by the single DELETE route and the
 * batch route.
 *
 * The ORDER is the contract and it is enforced here, not by the callers:
 *  1. refuse a pending `new-…` chat and an id that is not one path segment —
 *     both name something other than the session they appear to;
 *  2. refuse a session whose omp child is mid-turn (a run, a live subagent, or
 *     a dialog the agent is blocked on) — the delete would kill work the user
 *     can still see, and omp would flush the file back on shutdown anyway;
 *  3. destroy the child and AWAIT its exit — omp writes session state on
 *     shutdown and would otherwise recreate the transcript just removed;
 *  4. purge side questions, then the transcript, artifacts and Kabmo rows.
 *
 * A batch that re-implemented any of this would drift from the single delete,
 * and the drift would be silent: the route answers per-id verdicts either way.
 */

import { getRpcSession } from '@/server/lib/omp/rpc/session-registry';
import { purgeSessionData } from '@/server/lib/omp/session/delete.server';
import { purgeBtwForSession } from '@/server/lib/btw/purge.server';
import { isSinglePathSegment } from '@/server/lib/fs/path-segment';
import { isMockMode } from '@/server/mock.server';

export interface SessionRemoval {
  /** True when the session was removed (or would have been, in mock mode). */
  ok: boolean;
  /** HTTP status the single-session route answers with; batch callers use `error`. */
  status: number;
  code?: 'session_pending' | 'invalid_id' | 'session_busy' | 'not_found';
  error?: string;
  fileRemoved?: boolean;
  artifactsRemoved?: boolean;
  btwTopicsRemoved?: number;
}

/**
 * Remove one session, in the documented order. Never throws: every failure is
 * a verdict, because a batch has to keep going after one refused id.
 */
export async function removeSession(sessionId: string): Promise<SessionRemoval> {
  if (sessionId.startsWith('new-')) {
    return {
      ok: false,
      status: 400,
      code: 'session_pending',
      error: 'This chat has not been created yet.',
    };
  }
  // The id names a directory under the sessions root and another under the btw
  // root, so it must be exactly one path segment — see `isSinglePathSegment`
  // for the `.` case that made this load-bearing.
  if (!isSinglePathSegment(sessionId)) {
    return { ok: false, status: 400, code: 'invalid_id', error: 'Invalid session id' };
  }

  try {
    // A live child is the only other writer of the transcript. Busy means a
    // turn, a live subagent, or a dialog omp is parked on.
    const live = getRpcSession(sessionId);
    if (live?.isAlive()) {
      if (live.isBusy()) {
        return {
          ok: false,
          status: 409,
          code: 'session_busy',
          error: 'This session is working. Stop the run before deleting it.',
        };
      }
      await live.destroyAndWait();
    }

    // Side questions live outside the session file and are removed first: their
    // children must be gone before the parent transcript they were snapshotted
    // from disappears.
    const btwTopicsRemoved = isMockMode() ? 0 : await purgeBtwForSession(sessionId);
    const purged = await purgeSessionData(sessionId);
    if (!purged.found) {
      return { ok: false, status: 404, code: 'not_found', error: 'Session not found' };
    }

    return {
      ok: true,
      status: 200,
      fileRemoved: purged.fileRemoved,
      artifactsRemoved: purged.artifactsRemoved,
      btwTopicsRemoved,
    };
  } catch (error) {
    return {
      ok: false,
      status: 500,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
