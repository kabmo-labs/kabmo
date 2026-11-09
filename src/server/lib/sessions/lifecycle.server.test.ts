/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { getDb } from '@/server/db.server';
import { ensureSessionRelationsSchema } from '@/server/lib/sessions/schema.server';
import { createSessionRelation } from '@/server/lib/sessions/relations.server';
import {
  archiveDependents,
  collectDependents,
  dependentsDeepestFirst,
} from '@/server/lib/sessions/lifecycle.server';

beforeEach(async () => {
  await isolateDb();
  await ensureSessionRelationsSchema(await getDb());
});

afterEach(async () => {
  await releaseDb();
});

describe('session lifecycle cascade', () => {
  test('follows both the parent and the owner edge, once each', async () => {
    await createSessionRelation({ sessionId: 'root' });
    await createSessionRelation({ sessionId: 'child', parentSessionId: 'root' });
    await createSessionRelation({
      sessionId: 'grandchild',
      parentSessionId: 'child',
      lifecycleOwnerSessionId: 'root',
    });
    await createSessionRelation({
      sessionId: 'worker',
      lifecycleOwnerSessionId: 'root',
    });

    const dependents = await collectDependents('root');
    expect(new Set(dependents)).toEqual(new Set(['child', 'grandchild', 'worker']));
    expect(dependents).toHaveLength(3);
  });

  test('a fork is not a dependent of its source', async () => {
    await createSessionRelation({ sessionId: 'root' });
    await createSessionRelation({
      sessionId: 'fork-1',
      sourceSessionId: 'root',
      originKind: 'fork',
    });
    expect(await collectDependents('root')).toEqual([]);
  });

  test('archiveDependents writes only the rows that were not archived', async () => {
    await createSessionRelation({ sessionId: 'root' });
    await createSessionRelation({ sessionId: 'child', parentSessionId: 'root' });
    await createSessionRelation({ sessionId: 'grandchild', parentSessionId: 'child' });
    const db = await getDb();
    await db.run('INSERT INTO archived_sessions (session_id) VALUES (?)', ['child']);

    expect(await archiveDependents('root')).toEqual(['grandchild']);
    const rows = (await db.all('SELECT session_id FROM archived_sessions ORDER BY session_id')) as {
      session_id: string;
    }[];
    expect(rows.map((row) => row.session_id)).toEqual(['child', 'grandchild']);
  });

  test('deepest-first is the reverse of the walk', async () => {
    await createSessionRelation({ sessionId: 'root' });
    await createSessionRelation({ sessionId: 'child', parentSessionId: 'root' });
    await createSessionRelation({ sessionId: 'grandchild', parentSessionId: 'child' });
    expect(await dependentsDeepestFirst('root')).toEqual(['grandchild', 'child']);
  });
});
