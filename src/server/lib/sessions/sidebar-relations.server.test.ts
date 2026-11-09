/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { getDb } from '@/server/db.server';
import { ensureSessionRelationsSchema } from '@/server/lib/sessions/schema.server';
import { createSessionRelation } from '@/server/lib/sessions/relations.server';
import { decorateSidebarSessions } from '@/server/lib/sessions/sidebar-relations.server';
import type { SessionItemData } from '@/shared/types';

function row(id: string): SessionItemData {
  return { id, folder_id: 1, title: id };
}

beforeEach(async () => {
  await isolateDb();
  await ensureSessionRelationsSchema(await getDb());
});

afterEach(async () => {
  await releaseDb();
});

describe('decorateSidebarSessions', () => {
  test('adds the parent edge and direct child count', async () => {
    await createSessionRelation({ sessionId: 'parent' });
    await createSessionRelation({ sessionId: 'c1', parentSessionId: 'parent' });
    await createSessionRelation({ sessionId: 'c2', parentSessionId: 'parent' });
    await createSessionRelation({
      sessionId: 'fork-1',
      sourceSessionId: 'parent',
      originKind: 'fork',
    });

    const [parent, c1, c2, fork] = await decorateSidebarSessions([
      row('parent'),
      row('c1'),
      row('c2'),
      row('fork-1'),
    ]);
    expect(parent).toMatchObject({ childSessionCount: 2 });
    expect(parent?.parentSessionId).toBeUndefined();
    expect(c1).toMatchObject({ parentSessionId: 'parent', childSessionCount: 0 });
    expect(c2).toMatchObject({ parentSessionId: 'parent', childSessionCount: 0 });
    expect(fork).toMatchObject({ childSessionCount: 0 });
    expect(fork?.parentSessionId).toBeUndefined();
  });

  test('a hidden session is not drawn, but a visible one with no relation is', async () => {
    await createSessionRelation({
      sessionId: 'worker',
      parentSessionId: 'parent',
      visibility: 'hidden',
    });
    const rows = await decorateSidebarSessions([row('worker'), row('plain')]);
    expect(rows.map((entry) => entry.id)).toEqual(['plain']);
  });
});
