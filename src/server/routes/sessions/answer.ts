/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * GET /api/sessions/:sessionId/answer — the last assistant text a turn closed.
 *
 * ACP has no transcript for `/api/chat/:id` to read after the process dies, so
 * `kabmo session output` needs this row. A null answer is a real state (the
 * session has not answered yet), not an error.
 */

import { json } from '@/server/lib/remix-compat';
import type { LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { loadSessionAnswer } from '@/server/lib/sessions/answers.server';

export async function getSessionAnswer({ request, params }: LoaderFunctionArgs) {
  if (request.method !== 'GET') return methodNotAllowed({ request, params });
  const sessionId = params.sessionId;
  if (!sessionId) return json({ error: 'Missing session id' }, { status: 400 });
  return json({ sessionId, answer: await loadSessionAnswer(sessionId) });
}
