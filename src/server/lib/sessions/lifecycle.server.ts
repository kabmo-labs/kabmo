/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The sessions that follow an owner into the archive, or out of existence.
 *
 * Two edges cascade and they are independent: the sidebar parent
 * (`parent_session_id`) and cleanup ownership (`lifecycle_owner_session_id`).
 * A session can be one without the other, and a fork is neither — a source edge
 * never makes a session a dependent, so deleting or archiving a source leaves
 * its forks alone.
 *
 * Collection is breadth-first with a visited set: the two edges may point at
 * the same session, and a corrupted cycle must not hang a delete.
 */

import { getDb } from '@/server/db.server';
import { listChildRelations, listOwnedRelations } from '@/server/lib/sessions/relations.server';

/** Every dependent descendant, parents first, deduplicated, excluding the root. */
export async function collectDependents(sessionId: string): Promise<string[]> {
  const seen = new Set<string>([sessionId]);
  const ordered: string[] = [];
  const queue = [sessionId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const [children, owned] = await Promise.all([
      listChildRelations(current),
      listOwnedRelations(current),
    ]);
    for (const relation of [...children, ...owned]) {
      const id = relation.sessionId;
      if (seen.has(id)) continue;
      seen.add(id);
      ordered.push(id);
      queue.push(id);
    }
  }
  return ordered;
}

/**
 * Archive every dependent of a session. Returns the ids this call archived.
 *
 * Unarchiving is deliberately NOT the reverse: the reference product restores
 * explicitly, owner first, because auto-restoring a fan-out would resurrect
 * work the user archived one session at a time.
 */
export async function archiveDependents(sessionId: string): Promise<string[]> {
  const dependents = await collectDependents(sessionId);
  if (dependents.length === 0) return [];
  const db = await getDb();
  const archived: string[] = [];
  for (const id of dependents) {
    const result = await db.run(
      'INSERT OR IGNORE INTO archived_sessions (session_id) VALUES (?)',
      [id],
    );
    if (result.changes > 0) archived.push(id);
  }
  return archived;
}

/** Deepest-first, so a parent is removed after the sessions that name it. */
export async function dependentsDeepestFirst(sessionId: string): Promise<string[]> {
  const dependents = await collectDependents(sessionId);
  return dependents.reverse();
}
