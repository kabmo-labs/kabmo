/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Whether one session's agent token may act on another session.
 *
 * The rule is the TREE, not one id: a session may act on itself, on its
 * ancestors, and on its descendants. That is exactly the two directions the
 * orchestration contract uses — a worker tells its coordinator, a coordinator
 * reads its worker — and nothing else. A sibling is a different branch, and a
 * fork has a source edge rather than a parent edge, so neither is reachable.
 *
 * Why this module exists at all: the gate used to compare the id in the path to
 * the token's session, which refused BOTH directions. With UI authentication
 * off the gate returns before that comparison, so the defect was invisible in
 * the measured three-worker run and fatal on a password-protected console.
 *
 * The walk is two recursive CTEs over `session_relations`, both bounded by a
 * depth guard. The guard is 8, not `MAX_SESSION_DEPTH` (4): 4 is the policy the
 * spawn service enforces, 8 is what stops a corrupt row from looping forever.
 * A policy check inside the recursion would turn bad data into a hang.
 */

import { getDb } from '@/server/db.server';

export type AgentAccess = 'self' | 'ancestor' | 'descendant' | null;

/** How far a walk may go before it is treated as corrupt data, not a tree. */
const WALK_GUARD = 8;

/**
 * The relationship between the caller and the target, or null when the target
 * is outside the caller's tree.
 *
 * A session with no relation row is a root: it may act on itself and on nothing
 * else. A fork row has `parent_session_id = NULL`, so it never appears in
 * either walk — that is the schema, not a special case here.
 */
export async function resolveAgentAccess(caller: string, target: string): Promise<AgentAccess> {
  if (caller === target) return 'self';
  const db = await getDb();

  // Down: start at the caller and follow parent edges forward.
  const down = await db.get<{ hit: number }>(
    `WITH RECURSIVE down(id, depth) AS (
       SELECT session_id, 0 FROM session_relations WHERE session_id = ?
       UNION ALL
       SELECT r.session_id, down.depth + 1
         FROM session_relations r JOIN down ON r.parent_session_id = down.id
        WHERE down.depth < ${WALK_GUARD}
     ) SELECT 1 AS hit FROM down WHERE id = ? LIMIT 1`,
    [caller, target],
  );
  if (down) return 'descendant';

  // Up: start at the caller's parent and follow parent edges backward. Starting
  // at the TARGET's parent would answer the descendant question a second time.
  const up = await db.get<{ hit: number }>(
    `WITH RECURSIVE up(id, depth) AS (
       SELECT parent_session_id, 1 FROM session_relations WHERE session_id = ?
       UNION ALL
       SELECT r.parent_session_id, up.depth + 1
         FROM session_relations r JOIN up ON r.session_id = up.id
        WHERE up.depth < ${WALK_GUARD}
     ) SELECT 1 AS hit FROM up WHERE id = ? LIMIT 1`,
    [caller, target],
  );
  return up ? 'ancestor' : null;
}
