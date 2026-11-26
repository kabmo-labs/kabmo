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

import { json } from '@kabmo-labs/kabmo-http';
import type { LoaderFunctionArgs } from '@kabmo-labs/kabmo-http';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { loadSessionAnswer } from '@kabmo-labs/kabmo-session/relations/answers.server';
import { loadStreamStates } from '@kabmo-labs/kabmo-session/stream-state';

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
