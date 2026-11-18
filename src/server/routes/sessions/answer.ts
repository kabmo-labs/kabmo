/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * GET /api/sessions/:sessionId/answer — the last assistant text a turn closed,
 * and why the run failed when it did.
 *
 * ACP has no transcript for `/api/chat/:id` to read after the process dies, so
 * `kabmo session output` needs this row. A null answer is a real state (the
 * session has not answered yet), not an error.
 *
 * `failure` rides along because a FAILED run has no answer at all: without it
 * the command printed "No assistant answer recorded." for a worker whose
 * provider had said exactly why, and a coordinator had nothing to report.
 */

import { json } from '@/server/lib/remix-compat';
import type { LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { loadSessionAnswer } from '@/server/lib/sessions/answers.server';
import { loadStreamStates } from '@/shared/lib/omp/session/stream-state.server';

export async function getSessionAnswer({ request, params }: LoaderFunctionArgs) {
  if (request.method !== 'GET') return methodNotAllowed({ request, params });
  const sessionId = params.sessionId;
  if (!sessionId) return json({ error: 'Missing session id' }, { status: 400 });
  const states = await loadStreamStates();
  return json({
    sessionId,
    answer: await loadSessionAnswer(sessionId),
    failure: states[sessionId]?.failure ?? null,
  });
}
