/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Control of ONE running subagent, without touching the parent turn.
 *
 * omp exposes `cancel_subagent` (hard-kill one running subagent) and
 * `steer_subagent` (send it a message as its user) on RPC. Both act on the
 * session's live child, so they are dispatched through the same wrapper the
 * chat uses — and like every other command they must NOT boot an omp process to
 * answer: a subagent is by definition something the session's own child is
 * running, so a session this process does not manage has none to cancel.
 *
 * The id is the roster id the session file and `get_subagents` both report
 * (measured on omp 18.8.3: `Sleeper`, `ListOmpws` — a slug, not a uuid). It is
 * validated against the same grammar the transcript path derivation uses,
 * because the value arrives from the client.
 */

import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs } from '@/server/lib/remix-compat';
import { requireParam } from '@/server/lib/route-adapter';
import { getRpcSession } from '@/server/lib/omp/rpc/manager';
import { rpcErrorResponse } from '@/server/lib/omp/rpc/errors';
import { SUBAGENT_ID_MAX_LENGTH, SUBAGENT_ID_RE } from '@/server/lib/omp/subagent/history/paths';

/** `POST /api/sessions/:sessionId/subagents/:subagentId/cancel`. */
export async function cancelSubagent({ request, params }: ActionFunctionArgs) {
  const sessionId = requireParam(params, 'sessionId');
  const subagentId = requireParam(params, 'subagentId');
  if (!sessionId || !subagentId) return json({ error: 'Missing session or subagent id' }, { status: 400 });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });
  if (!SUBAGENT_ID_RE.test(subagentId) || subagentId.length > SUBAGENT_ID_MAX_LENGTH) {
    return json({ error: 'Invalid subagent id', code: 'invalid_subagent_id' }, { status: 400 });
  }

  const session = getRpcSession(sessionId);
  if (!session?.isAlive()) {
    return json({ error: 'Session is not running', code: 'session_not_running' }, { status: 409 });
  }
  try {
    const result = await session.send({ type: 'cancel_subagent', subagentId });
    return json({ success: true, data: result ?? null });
  } catch (error) {
    return rpcErrorResponse(error);
  }
}

/** `POST /api/sessions/:sessionId/subagents/:subagentId/steer` — body `{ message }`. */
export async function steerSubagent({ request, params }: ActionFunctionArgs) {
  const sessionId = requireParam(params, 'sessionId');
  const subagentId = requireParam(params, 'subagentId');
  if (!sessionId || !subagentId) return json({ error: 'Missing session or subagent id' }, { status: 400 });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });
  if (!SUBAGENT_ID_RE.test(subagentId) || subagentId.length > SUBAGENT_ID_MAX_LENGTH) {
    return json({ error: 'Invalid subagent id', code: 'invalid_subagent_id' }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as { message?: unknown } | null;
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  if (!message) return json({ error: 'message is required' }, { status: 400 });

  const session = getRpcSession(sessionId);
  if (!session?.isAlive()) {
    return json({ error: 'Session is not running', code: 'session_not_running' }, { status: 409 });
  }
  try {
    const result = await session.send({ type: 'steer_subagent', subagentId, message });
    return json({ success: true, data: result ?? null });
  } catch (error) {
    return rpcErrorResponse(error);
  }
}
