/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Session trees: the parent edge (sidebar + outcome notifications), the
 * cleanup owner edge, and the fork origin edge.
 *
 * Sessions are not rows — an omp chat is a file, an ACP chat belongs to the
 * agent — so this module stores only relationships and validates only their
 * shape. Whether a parent is still alive, and whether it belongs to the same
 * workspace folder, is the spawn service's question (it can resolve a session's
 * cwd); a relation module that guessed either would be wrong for one transport.
 *
 * The depth cap is enforced HERE because it is a property of the tree, not of
 * the UI: four levels, matching the reference, and a reparent computes the
 * subtree height so a deep branch cannot be lifted under a deep parent.
 */

import { getDb } from '@/server/db.server';
import { forgetAgentTokenCache } from '@/server/lib/sessions/agent-token.server';

import {
  MAX_SESSION_DEPTH,
  SessionRelationError,
  fromRow,
  type ParentNotifications,
  type RelationRow,
  type SessionOriginKind,
  type SessionRelation,
  type SessionVisibility,
} from '@/server/lib/sessions/relation-types';

function requireId(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new SessionRelationError('invalid_argument', `${field} is required`);
  }
  return trimmed;
}

/** One session's row, or null when it never had a relationship. */
export async function getSessionRelation(sessionId: string): Promise<SessionRelation | null> {
  const db = await getDb();
  const row = await db.get<RelationRow>(
    'SELECT * FROM session_relations WHERE session_id = ?',
    [sessionId],
  );
  return row ? fromRow(row) : null;
}

/** Every relation — the sidebar attaches these in one read. */
export async function listSessionRelations(): Promise<SessionRelation[]> {
  const db = await getDb();
  const rows = await db.all<RelationRow>('SELECT * FROM session_relations');
  return rows.map(fromRow);
}

/** Direct children, ordered by creation (the order the tree draws them). */
export async function listChildRelations(parentSessionId: string): Promise<SessionRelation[]> {
  const db = await getDb();
  const rows = await db.all<RelationRow>(
    'SELECT * FROM session_relations WHERE parent_session_id = ? ORDER BY created_at ASC, session_id ASC',
    [parentSessionId],
  );
  return rows.map(fromRow);
}

/** Forks of one source, in creation order. */
export async function listForkRelations(sourceSessionId: string): Promise<SessionRelation[]> {
  const db = await getDb();
  const rows = await db.all<RelationRow>(
    "SELECT * FROM session_relations WHERE source_session_id = ? AND origin_kind = 'fork' ORDER BY created_at ASC, session_id ASC",
    [sourceSessionId],
  );
  return rows.map(fromRow);
}

/** Sessions this one owns for archive/delete cleanup. */
export async function listOwnedRelations(ownerSessionId: string): Promise<SessionRelation[]> {
  const db = await getDb();
  const rows = await db.all<RelationRow>(
    'SELECT * FROM session_relations WHERE lifecycle_owner_session_id = ? ORDER BY created_at ASC, session_id ASC',
    [ownerSessionId],
  );
  return rows.map(fromRow);
}

/** Depth of a session in the parent tree; a session with no row is a root. */
export async function sessionDepth(sessionId: string): Promise<number> {
  const relation = await getSessionRelation(sessionId);
  return relation?.depth ?? 0;
}

/** The deepest descendant under a session, counted inclusively (itself = 1). */
async function subtreeHeight(sessionId: string, seen = new Set<string>()): Promise<number> {
  if (seen.has(sessionId)) {
    throw new SessionRelationError('cycle', 'Session tree contains a cycle');
  }
  seen.add(sessionId);
  const children = await listChildRelations(sessionId);
  let height = 1;
  for (const child of children) {
    height = Math.max(height, 1 + (await subtreeHeight(child.sessionId, seen)));
  }
  seen.delete(sessionId);
  return height;
}

/** Walk up from a candidate parent; a hit on the child is a cycle. */
async function assertNoCycle(childSessionId: string, parentSessionId: string): Promise<void> {
  const seen = new Set<string>();
  let current: string | null = parentSessionId;
  while (current !== null) {
    if (current === childSessionId) {
      throw new SessionRelationError('cycle', 'A session cannot be its own ancestor');
    }
    if (seen.has(current)) {
      throw new SessionRelationError('cycle', 'Session tree contains a cycle');
    }
    seen.add(current);
    const relation = await getSessionRelation(current);
    current = relation?.parentSessionId ?? null;
  }
}

export interface CreateSessionRelationInput {
  sessionId: string;
  parentSessionId?: string | null;
  lifecycleOwnerSessionId?: string | null;
  sourceSessionId?: string | null;
  originKind?: SessionOriginKind | null;
  visibility?: SessionVisibility;
  parentNotifications?: ParentNotifications;
}

/**
 * Insert the relation for a new session.
 *
 * A fork is a SOURCE edge, not a child: `origin_kind = 'fork'` requires a
 * source and forbids a parent, because a source-derived session stays silent
 * and is listed under "Forks", not under the parent's tree. A user can reparent
 * it afterwards; the origin stays.
 */
export async function createSessionRelation(
  input: CreateSessionRelationInput,
): Promise<SessionRelation> {
  const sessionId = requireId(input.sessionId, 'sessionId');
  const parentSessionId = input.parentSessionId
    ? requireId(input.parentSessionId, 'parentSessionId')
    : null;
  const lifecycleOwnerSessionId = input.lifecycleOwnerSessionId
    ? requireId(input.lifecycleOwnerSessionId, 'lifecycleOwnerSessionId')
    : null;
  const sourceSessionId = input.sourceSessionId
    ? requireId(input.sourceSessionId, 'sourceSessionId')
    : null;
  const originKind = input.originKind ?? null;

  if (parentSessionId === sessionId) {
    throw new SessionRelationError('self_parent', 'A session cannot parent itself');
  }
  if (lifecycleOwnerSessionId === sessionId) {
    throw new SessionRelationError('invalid_argument', 'A session cannot own itself');
  }
  if (originKind === 'fork') {
    if (!sourceSessionId) {
      throw new SessionRelationError('fork_requires_source', 'A fork needs a source session');
    }
    if (parentSessionId !== null) {
      throw new SessionRelationError(
        'fork_is_not_a_child',
        'A fork is recorded as a source edge, not a parent edge',
      );
    }
    if (sourceSessionId === sessionId) {
      throw new SessionRelationError('invalid_argument', 'A fork cannot source itself');
    }
  } else if (sourceSessionId !== null) {
    throw new SessionRelationError('not_fork', 'A source session requires originKind "fork"');
  }

  const parentDepth = parentSessionId === null ? 0 : await sessionDepth(parentSessionId);
  const depth =
    originKind === 'fork' || parentSessionId === null ? 0 : parentDepth + 1;
  if (depth > MAX_SESSION_DEPTH) {
    throw new SessionRelationError(
      'depth_exceeded',
      `A session tree is limited to ${MAX_SESSION_DEPTH} levels`,
    );
  }
  if (parentSessionId !== null) await assertNoCycle(sessionId, parentSessionId);

  const visibility = input.visibility ?? 'visible';
  const parentNotifications = input.parentNotifications ?? 'auto';
  const createdAt = Date.now();
  const db = await getDb();
  await db.run(
    `INSERT INTO session_relations
       (session_id, parent_session_id, lifecycle_owner_session_id, source_session_id,
        origin_kind, visibility, parent_notifications, depth, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      sessionId,
      parentSessionId,
      lifecycleOwnerSessionId,
      sourceSessionId,
      originKind,
      visibility,
      parentNotifications,
      depth,
      createdAt,
    ],
  );
  return {
    sessionId,
    parentSessionId,
    lifecycleOwnerSessionId,
    sourceSessionId,
    originKind,
    visibility,
    parentNotifications,
    depth,
    createdAt,
  };
}

/**
 * Reparent a session, revalidating both directions: the new depth must fit,
 * the new parent must not be a descendant, and a fork keeps its origin while
 * gaining a tree position.
 */
export async function setSessionParent(
  sessionId: string,
  parentSessionId: string | null,
): Promise<SessionRelation> {
  const child = await getSessionRelation(sessionId);
  const newParent = parentSessionId
    ? requireId(parentSessionId, 'parentSessionId')
    : null;
  if (newParent === sessionId) {
    throw new SessionRelationError('self_parent', 'A session cannot parent itself');
  }
  if (newParent !== null) {
    await assertNoCycle(sessionId, newParent);
  }
  const newDepth = newParent === null ? 0 : (await sessionDepth(newParent)) + 1;
  const height = await subtreeHeight(sessionId);
  if (newDepth + height - 1 > MAX_SESSION_DEPTH) {
    throw new SessionRelationError(
      'depth_exceeded',
      `A session tree is limited to ${MAX_SESSION_DEPTH} levels`,
    );
  }

  const db = await getDb();
  if (child === null) {
    return createSessionRelation({ sessionId, parentSessionId: newParent });
  }
  await db.run(
    'UPDATE session_relations SET parent_session_id = ?, depth = ? WHERE session_id = ?',
    [newParent, newDepth, sessionId],
  );
  // Every descendant moves with the branch; recompute rather than trusting a
  // relative offset, so a corrupted depth cannot survive a reparent.
  await refreshSubtreeDepth(sessionId, newDepth);
  return {
    ...child,
    parentSessionId: newParent,
    depth: newDepth,
  };
}

async function refreshSubtreeDepth(sessionId: string, depth: number): Promise<void> {
  const db = await getDb();
  for (const child of await listChildRelations(sessionId)) {
    const childDepth = depth + 1;
    await db.run('UPDATE session_relations SET depth = ? WHERE session_id = ?', [
      childDepth,
      child.sessionId,
    ]);
    await refreshSubtreeDepth(child.sessionId, childDepth);
  }
}

/** Set the presentation flag; delivery is controlled separately. */
export async function setSessionVisibility(
  sessionId: string,
  visibility: SessionVisibility,
): Promise<void> {
  const db = await getDb();
  await db.run('UPDATE session_relations SET visibility = ? WHERE session_id = ?', [
    visibility,
    sessionId,
  ]);
}

/** Which child outcomes wake the parent. */
export async function setParentNotifications(
  sessionId: string,
  value: ParentNotifications,
): Promise<void> {
  const db = await getDb();
  await db.run('UPDATE session_relations SET parent_notifications = ? WHERE session_id = ?', [
    value,
    sessionId,
  ]);
}

/**
 * Drop a session's own relation and every incoming edge.
 *
 * A source edge is cleared rather than deleted: deleting a fork's source must
 * not delete the fork's history relationship row, and deleting a fork must not
 * touch its source. Parent and owner edges are nulled because the session they
 * named is gone; the cascade that deletes dependents runs before this.
 */
export async function deleteSessionRelations(sessionId: string): Promise<void> {
  const db = await getDb();
  db.raw.transaction(() => {
    db.raw
      .query('UPDATE session_relations SET source_session_id = NULL, origin_kind = NULL WHERE source_session_id = ?')
      .run(sessionId);
    db.raw
      .query('UPDATE session_relations SET parent_session_id = NULL, depth = 0 WHERE parent_session_id = ?')
      .run(sessionId);
    db.raw
      .query('UPDATE session_relations SET lifecycle_owner_session_id = NULL WHERE lifecycle_owner_session_id = ?')
      .run(sessionId);
    db.raw.query('DELETE FROM session_relations WHERE session_id = ?').run(sessionId);
    db.raw.query('DELETE FROM session_notices WHERE parent_session_id = ?').run(sessionId);
    db.raw.query('DELETE FROM session_agent_tokens WHERE session_id = ?').run(sessionId);
    db.raw.query('DELETE FROM session_answers WHERE session_id = ?').run(sessionId);
  })();
  forgetAgentTokenCache(sessionId);
}
