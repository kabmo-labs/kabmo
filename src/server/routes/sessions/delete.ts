/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * DELETE /api/sessions/:sessionId — remove a session and everything keyed to
 * it. The mirror of `archiveSession`: archive is reversible and keeps the
 * transcript, this one is the destructive path the user opts into from the
 * sidebar's trash button.
 *
 * The sequence (pending/id guard, busy refusal, child teardown, purge) lives in
 * `removeSession` because the batch route performs the same one per id; this
 * handler only maps the verdict onto a response.
 */

import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { removeSession } from '@/server/lib/omp/session/delete-flow.server';

export async function deleteSession({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'DELETE') {
    return methodNotAllowed({ request, params });
  }

  const sessionId = params.sessionId;
  if (!sessionId) return json({ error: 'Missing session id' }, { status: 400 });

  const result = await removeSession(sessionId);
  if (!result.ok) {
    return json(
      { error: result.error, code: result.code },
      { status: result.status },
    );
  }

  return json({
    success: true,
    sessionId,
    fileRemoved: result.fileRemoved,
    artifactsRemoved: result.artifactsRemoved,
    btwTopicsRemoved: result.btwTopicsRemoved,
  });
}
