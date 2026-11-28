/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The last-opened session: what a native shell restores on a cold start, and
 * the write every open makes.
 *
 * The record is keyed by the `kabmo_client` cookie, so a phone and a desktop
 * pointed at the same console keep separate pointers. Both routes resolve that
 * identity here rather than trusting a client-supplied id: a value the page can
 * choose would let one shell read or rewrite another's row.
 */

import { json, NO_STORE_HEADERS } from '@kabmo-labs/kabmo-http';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@kabmo-labs/kabmo-http';
import { isSinglePathSegment } from '@kabmo-labs/kabmo-paths/path-segment';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import {
  lastOpenedSession,
  recordLastOpenedSession,
} from '@/server/lib/sessions/last-opened.server';
import {
  readClientId,
  resolveClientIdentity,
} from '@/server/lib/sessions/last-opened-client.server';

/**
 * GET /api/sessions/last-opened — this client's validated id, or null.
 *
 * Never cached: the answer moves with every session the user opens, and a
 * shell's first request after a relaunch must not receive a previous response.
 */
export async function getLastOpenedSession({ request }: LoaderFunctionArgs) {
  const clientId = readClientId(request);
  const sessionId = clientId ? await lastOpenedSession(clientId) : null;
  return json({ sessionId }, { headers: NO_STORE_HEADERS });
}

/**
 * POST /api/sessions/:sessionId/opened — remember this session as the target
 * THIS client opens next time.
 *
 * A pending id is a refusal, not an error: the caller's URL may still name
 * `new-…`, and the record must wait for the spawn's real id. `recorded: false`
 * says which happened without turning a placeholder into a failed request.
 *
 * A request with no client cookie gets one, so a caller that reached this
 * endpoint without the document still lands on a row of its own.
 */
export async function markSessionOpened({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return methodNotAllowed({ request, params });
  }

  const sessionId = params.sessionId;
  if (!sessionId) return json({ error: 'Missing session id' }, { status: 400 });
  if (!isSinglePathSegment(sessionId)) return json({ error: 'Session not found' }, { status: 404 });

  const identity = resolveClientIdentity(request);
  const recorded = await recordLastOpenedSession(identity.clientId, sessionId);
  const headers: Record<string, string> = {};
  if (identity.setCookie) headers['set-cookie'] = identity.setCookie;
  return json({ success: true, recorded }, { headers });
}
