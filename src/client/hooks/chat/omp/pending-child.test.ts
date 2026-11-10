/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The pending row a "New child session" click creates.
 *
 * A child is a pending chat like any other — same store, same lifetime — but it
 * must land INSIDE its parent's branch and keep its branch slot, harness and
 * "New Child" title across the id switch a spawn performs. Both facts are
 * asserted here rather than in the store suite, because they are the ones the
 * tree depends on.
 */

import { beforeEach, describe, expect, test } from 'bun:test';

import {
  adoptPendingSession,
  listPendingSessions,
  releasePendingSession,
  startPendingSession,
} from '@/client/hooks/chat/omp/pending-sessions';
import { withPendingRows } from '@/client/hooks/chat/omp/pending-rows';
import { buildSessionTree } from '@/client/lib/session-tree';
import { formatNewSessionTitle } from '@/shared/lib/omp/session/default-title';
import type { WorkspaceFolderData } from '@/shared/types';

function folders(...ids: string[]): WorkspaceFolderData[] {
  return [{
    id: 1,
    name: 'ws',
    isExpanded: false,
    hasMore: false,
    totalSessions: ids.length,
    sessions: ids.map((id) => ({ id, folder_id: 1, title: id.toUpperCase() })),
  }];
}

function clear(): void {
  for (const entry of listPendingSessions()) releasePendingSession(entry.id);
}

beforeEach(clear);

describe('pending child rows', () => {
  test('a pending CHILD nests under its parent, with its harness and title', () => {
    const title = formatNewSessionTitle(new Date(), 'New Child');
    const id = startPendingSession(1, { parentSessionId: 'real-1', harness: 'claude', title });

    const out = withPendingRows(folders('real-1'), listPendingSessions(), { activeId: 'real-1' });
    const tree = buildSessionTree(out[0]?.sessions ?? []);
    const child = tree.childrenOf.get('real-1')?.[0];
    expect(tree.roots.map((session) => session.id)).toEqual(['real-1']);
    expect(child?.id).toBe(id);
    expect(child?.parentSessionId).toBe('real-1');
    expect(child?.harness).toBe('claude');
    expect(child?.title).toBe(title);
  });

  test('adoption keeps a child in its branch after the id switch', () => {
    const title = formatNewSessionTitle(new Date(), 'New Child');
    const id = startPendingSession(1, { parentSessionId: 'real-1', harness: 'claude', title });

    adoptPendingSession(id, 'omp-child', 1);
    const adopted = listPendingSessions().find((entry) => entry.id === 'omp-child');
    expect(adopted?.parentSessionId).toBe('real-1');
    expect(adopted?.harness).toBe('claude');
    expect(adopted?.title).toBe(title);
    // The old pending id is gone: one row, not two.
    expect(listPendingSessions().some((entry) => entry.id === id)).toBe(false);
  });
});
