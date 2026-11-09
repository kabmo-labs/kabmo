/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The tree around one session: its parent, children, forks and cleanup owner.
 *
 * A fork is deliberately NOT in `children`: it is a source-derived session and
 * stays silent, so listing it under the parent edge would promise a
 * notification that never comes. The info panel draws it from `forks`.
 */

import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed, parseJsonBody } from '@/server/lib/route-adapter';
import { emitRealtimeSignal } from '@/server/lib/realtime/signals.server';
import { SessionRelationError } from '@/server/lib/sessions/relation-types';
import {
  getSessionRelation,
  listChildRelations,
  listForkRelations,
  listOwnedRelations,
  setSessionParent,
} from '@/server/lib/sessions/relations.server';

export async function getSessionRelations({ request, params }: LoaderFunctionArgs) {
  if (request.method !== 'GET') return methodNotAllowed({ request, params });
  const sessionId = params.sessionId;
  if (!sessionId) return json({ error: 'Missing session id' }, { status: 400 });

  const [relation, children, forks, owned] = await Promise.all([
    getSessionRelation(sessionId),
    listChildRelations(sessionId),
    listForkRelations(sessionId),
    listOwnedRelations(sessionId),
  ]);
  return json({
    sessionId,
    parent: relation?.parentSessionId ? { sessionId: relation.parentSessionId } : null,
    parentNotifications: relation?.parentNotifications ?? 'auto',
    visibility: relation?.visibility ?? 'visible',
    origin: relation?.originKind
      ? { kind: relation.originKind, sourceSessionId: relation.sourceSessionId }
      : null,
    children: children.map((row) => ({
      sessionId: row.sessionId,
      visibility: row.visibility,
      parentNotifications: row.parentNotifications,
      depth: row.depth,
    })),
    forks: forks.map((row) => ({ sessionId: row.sessionId, visibility: row.visibility })),
    lifecycleOwner: relation?.lifecycleOwnerSessionId
      ? { sessionId: relation.lifecycleOwnerSessionId }
      : null,
    owned: owned.map((row) => ({ sessionId: row.sessionId })),
  });
}

export async function updateSessionParent({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') return methodNotAllowed({ request, params });
  const sessionId = params.sessionId;
  if (!sessionId) return json({ error: 'Missing session id' }, { status: 400 });

  const parsed = await parseJsonBody<{ parentSessionId?: unknown }>(request);
  if (!parsed.ok) return json({ error: 'Invalid JSON body' }, { status: 400 });
  const raw = parsed.body.parentSessionId;
  if (raw !== null && typeof raw !== 'string') {
    return json({ error: 'parentSessionId must be a string or null' }, { status: 400 });
  }

  try {
    const relation = await setSessionParent(sessionId, raw);
    emitRealtimeSignal('sidebar-structure');
    return json({ ok: true, parentSessionId: relation.parentSessionId, depth: relation.depth });
  } catch (error) {
    if (error instanceof SessionRelationError) {
      return json({ error: error.message, code: error.code }, { status: 409 });
    }
    return json(
      { error: error instanceof Error ? error.message : 'Could not reparent the session' },
      { status: 500 },
    );
  }
}
