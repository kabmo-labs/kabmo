/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * DELETE /api/sessions/:sessionId — remove a session and everything keyed to
 * it. The mirror of `archiveSession`: archive is reversible and keeps the
 * transcript, this one is the destructive path the user opts into from the
 * sidebar's trash button.
 *
 * Order matters and is enforced here, not by the callers:
 *  1. refuse a session whose omp child is mid-turn (a run, a live subagent, or
 *     a dialog the agent is blocked on) — the delete would kill work the user
 *     can still see, and omp would flush the file back on shutdown anyway;
 *  2. destroy the child and AWAIT its exit — omp writes session state on
 *     shutdown and would otherwise recreate the transcript just removed;
 *  3. purge side questions, then the transcript, artifacts and Kabmo rows.
 *
 * A pending `new-…` session is refused: it is a client-side placeholder with
 * nothing stored anywhere yet, so deleting it is the same as navigating away.
 */

import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { getRpcSession } from '@/server/lib/omp/rpc/session-registry';
import { purgeSessionData } from '@/server/lib/omp/session/delete.server';
import { purgeBtwForSession } from '@/server/lib/btw/purge.server';
import { isSinglePathSegment } from '@/server/lib/fs/path-segment';
import { isMockMode } from '@/server/mock.server';

export async function deleteSession({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'DELETE') {
    return methodNotAllowed({ request, params });
  }

  const sessionId = params.sessionId;
  if (!sessionId) return json({ error: 'Missing session id' }, { status: 400 });
  if (sessionId.startsWith('new-')) {
    return json({ error: 'This chat has not been created yet.', code: 'session_pending' }, { status: 400 });
  }
  // The id names a directory under the sessions root and another under the btw
  // root, so it must be exactly one path segment — see `isSinglePathSegment`
  // for the `.` case that made this load-bearing. Both purges re-check it
  // independently; refusing here is what turns the attempt into a 400.
  if (!isSinglePathSegment(sessionId)) {
    return json({ error: 'Invalid session id' }, { status: 400 });
  }

  // A live child is the only other writer of the transcript. Busy means a turn,
  // a live subagent, or a dialog omp is parked on — all things the user can
  // still act on, so the delete is refused with a reason rather than silently
  // taking them down.
  const live = getRpcSession(sessionId);
  if (live?.isAlive()) {
    if (live.isBusy()) {
      return json(
        { error: 'This session is working. Stop the run before deleting it.', code: 'session_busy' },
        { status: 409 },
      );
    }
    await live.destroyAndWait();
  }

  // Side questions live outside the session file and are removed first: their
  // children must be gone before the parent transcript they were snapshotted
  // from disappears.
  const btwTopicsRemoved = isMockMode() ? 0 : await purgeBtwForSession(sessionId);
  const purged = await purgeSessionData(sessionId);

  if (!purged.found) {
    return json({ error: 'Session not found' }, { status: 404 });
  }

  return json({
    success: true,
    sessionId,
    fileRemoved: purged.fileRemoved,
    artifactsRemoved: purged.artifactsRemoved,
    btwTopicsRemoved,
  });
}
