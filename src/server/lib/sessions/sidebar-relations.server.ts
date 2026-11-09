/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Sidebar rows, decorated with their tree fields.
 *
 * One relation read for the whole folder: `parentSessionId` lets the client
 * build the tree, `childSessionCount` decides whether a row draws a chevron,
 * and `visibility: hidden` keeps a background worker out of the list while it
 * stays addressable by id (and still notifies its parent).
 */

import type { SessionItemData } from '@/shared/types';
import { listSessionRelations } from '@/server/lib/sessions/relations.server';

export async function decorateSidebarSessions(
  sessions: readonly SessionItemData[],
): Promise<SessionItemData[]> {
  let relations: Awaited<ReturnType<typeof listSessionRelations>> = [];
  try {
    relations = await listSessionRelations();
  } catch {
    // A database opened before this feature's tables existed: no tree, and
    // never an error page over the whole sidebar.
  }
  const relationBySession = new Map(relations.map((relation) => [relation.sessionId, relation]));
  const childCountByParent = new Map<string, number>();
  for (const relation of relations) {
    if (!relation.parentSessionId) continue;
    childCountByParent.set(
      relation.parentSessionId,
      (childCountByParent.get(relation.parentSessionId) ?? 0) + 1,
    );
  }
  return sessions
    .filter((session) => relationBySession.get(String(session.id))?.visibility !== 'hidden')
    .map((session) => {
      const relation = relationBySession.get(String(session.id));
      return {
        ...session,
        ...(relation?.parentSessionId ? { parentSessionId: relation.parentSessionId } : {}),
        childSessionCount: childCountByParent.get(String(session.id)) ?? 0,
      };
    });
}
