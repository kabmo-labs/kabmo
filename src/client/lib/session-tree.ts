/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A flat session list → roots plus a parent→children map.
 *
 * A child session is a session, so the sidebar draws it under its parent. A
 * session whose parent is not in the same folder (a cross-folder relation, or
 * one the current filter/window removed) stays a root: hiding it would make a
 * row the user can still open by URL unreachable from the sidebar.
 *
 * Pure and order-preserving: the list's own sort is the tree's sort.
 */

import type { SessionItemData } from '@/shared/types';

export interface SessionTree {
  roots: SessionItemData[];
  childrenOf: Map<string, SessionItemData[]>;
}

export function buildSessionTree(sessions: readonly SessionItemData[]): SessionTree {
  const present = new Set(sessions.map((session) => String(session.id)));
  const childrenOf = new Map<string, SessionItemData[]>();
  const roots: SessionItemData[] = [];

  for (const session of sessions) {
    const parentId = session.parentSessionId;
    if (!parentId || !present.has(parentId) || parentId === String(session.id)) {
      roots.push(session);
      continue;
    }
    const bucket = childrenOf.get(parentId);
    if (bucket) bucket.push(session);
    else childrenOf.set(parentId, [session]);
  }

  return { roots, childrenOf };
}

/** Every descendant of a session, depth-first, with its depth (root child = 1). */
export function descendantsOf(
  sessionId: string,
  childrenOf: Map<string, SessionItemData[]>,
  depth = 1,
  seen = new Set<string>(),
): Array<{ session: SessionItemData; depth: number }> {
  if (seen.has(sessionId)) return [];
  seen.add(sessionId);
  const out: Array<{ session: SessionItemData; depth: number }> = [];
  for (const child of childrenOf.get(sessionId) ?? []) {
    if (seen.has(String(child.id))) continue;
    out.push({ session: child, depth });
    out.push(...descendantsOf(String(child.id), childrenOf, depth + 1, seen));
  }
  return out;
}
