/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Session trees: depth, cycles, the fork edge, and cleanup edges.
 *
 * A session has no row of its own, so these cases use bare ids — which is the
 * point of the module: the tree is a relationship store, and every rule here
 * must hold for an omp file and an ACP session alike.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { getDb } from '@/server/db.server';
import { ensureSessionRelationsSchema } from '@/server/lib/sessions/schema.server';
import {
  MAX_SESSION_DEPTH,
  SessionRelationError,
} from '@/server/lib/sessions/relation-types';
import {
  createSessionRelation,
  deleteSessionRelations,
  getSessionRelation,
  listChildRelations,
  listForkRelations,
  listOwnedRelations,
  setParentNotifications,
  setSessionParent,
  setSessionVisibility,
} from '@/server/lib/sessions/relations.server';

beforeEach(async () => {
  await isolateDb();
  // The relations tables are created by `initSchema`; the explicit call keeps
  // this suite runnable when it is the first to open the temp database.
  await ensureSessionRelationsSchema(await getDb());
});

afterEach(async () => {
  await releaseDb();
});

/** The error code a rejected call reported, or null when it resolved. */
async function rejectionCode(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return error instanceof SessionRelationError ? error.code : `unexpected:${String(error)}`;
  }
}

describe('session relations', () => {
  test('a child of a root starts at depth 1 and carries the parent edge', async () => {
    const relation = await createSessionRelation({
      sessionId: 'child',
      parentSessionId: 'root',
      lifecycleOwnerSessionId: 'root',
    });
    expect(relation).toMatchObject({
      sessionId: 'child',
      parentSessionId: 'root',
      lifecycleOwnerSessionId: 'root',
      depth: 1,
      visibility: 'visible',
      parentNotifications: 'auto',
      originKind: null,
    });
    expect(await listChildRelations('root')).toHaveLength(1);
  });

  test(`the tree stops at ${MAX_SESSION_DEPTH} levels`, async () => {
    await createSessionRelation({ sessionId: 'l1', parentSessionId: 'root' });
    await createSessionRelation({ sessionId: 'l2', parentSessionId: 'l1' });
    await createSessionRelation({ sessionId: 'l3', parentSessionId: 'l2' });
    // l4 is the fourth level and is allowed.
    const fourth = await createSessionRelation({ sessionId: 'l4', parentSessionId: 'l3' });
    expect(fourth.depth).toBe(4);

    expect(
      await rejectionCode(() =>
        createSessionRelation({ sessionId: 'l5', parentSessionId: 'l4' }),
      ),
    ).toBe('depth_exceeded');
  });

  test('a session cannot be reparented under its own descendant', async () => {
    await createSessionRelation({ sessionId: 'a' });
    await createSessionRelation({ sessionId: 'b', parentSessionId: 'a' });
    await createSessionRelation({ sessionId: 'c', parentSessionId: 'b' });

    expect(await rejectionCode(() => setSessionParent('a', 'c'))).toBe('cycle');
    expect(await rejectionCode(() => setSessionParent('a', 'a'))).toBe('self_parent');
  });

  test('reparenting recomputes every descendant depth', async () => {
    await createSessionRelation({ sessionId: 'a' });
    await createSessionRelation({ sessionId: 'b', parentSessionId: 'a' });
    await createSessionRelation({ sessionId: 'c', parentSessionId: 'b' });

    await setSessionParent('b', null);
    expect((await getSessionRelation('b'))?.depth).toBe(0);
    expect((await getSessionRelation('c'))?.depth).toBe(1);
    expect((await getSessionRelation('c'))?.parentSessionId).toBe('b');

    await setSessionParent('b', 'a');
    expect((await getSessionRelation('b'))?.depth).toBe(1);
    expect((await getSessionRelation('c'))?.depth).toBe(2);
  });

  test('reparenting a branch refuses when the moved subtree would exceed the cap', async () => {
    await createSessionRelation({ sessionId: 'a' });
    await createSessionRelation({ sessionId: 'b', parentSessionId: 'a' });
    await createSessionRelation({ sessionId: 'c', parentSessionId: 'b' });
    await createSessionRelation({ sessionId: 'd', parentSessionId: 'c' });
    await createSessionRelation({ sessionId: 'deep1', parentSessionId: 'root1' });
    await createSessionRelation({ sessionId: 'deep2', parentSessionId: 'deep1' });
    await createSessionRelation({ sessionId: 'deep3', parentSessionId: 'deep2' });

    // `a` is 4 tall; `deep3` is level 3, so a + 3 would be 6.
    expect(await rejectionCode(() => setSessionParent('a', 'deep3'))).toBe('depth_exceeded');
  });

  test('a fork is a source edge, never a parent edge', async () => {
    const fork = await createSessionRelation({
      sessionId: 'fork-1',
      sourceSessionId: 'source',
      originKind: 'fork',
    });
    expect(fork).toMatchObject({
      parentSessionId: null,
      sourceSessionId: 'source',
      originKind: 'fork',
      depth: 0,
    });
    expect((await listForkRelations('source')).map((row) => row.sessionId)).toEqual(['fork-1']);

    expect(
      await rejectionCode(() =>
        createSessionRelation({
          sessionId: 'fork-2',
          sourceSessionId: 'source',
          parentSessionId: 'parent',
          originKind: 'fork',
        }),
      ),
    ).toBe('fork_is_not_a_child');
    expect(
      await rejectionCode(() =>
        createSessionRelation({ sessionId: 'fork-3', originKind: 'fork' }),
      ),
    ).toBe('fork_requires_source');
    expect(
      await rejectionCode(() =>
        createSessionRelation({ sessionId: 'plain', sourceSessionId: 'source' }),
      ),
    ).toBe('not_fork');
  });

  test('visibility and notifications are presentation and delivery, independently', async () => {
    await createSessionRelation({ sessionId: 'child', parentSessionId: 'root' });
    await setSessionVisibility('child', 'hidden');
    await setParentNotifications('child', 'stuck');
    expect(await getSessionRelation('child')).toMatchObject({
      visibility: 'hidden',
      parentNotifications: 'stuck',
      parentSessionId: 'root',
    });
    expect(await listChildRelations('root')).toHaveLength(1);
  });

  test('a cleanup owner sees every dependent, across parents', async () => {
    await createSessionRelation({ sessionId: 'a', lifecycleOwnerSessionId: 'boss' });
    await createSessionRelation({
      sessionId: 'b',
      parentSessionId: 'a',
      lifecycleOwnerSessionId: 'boss',
    });
    await createSessionRelation({ sessionId: 'c', lifecycleOwnerSessionId: 'other' });
    expect((await listOwnedRelations('boss')).map((row) => row.sessionId)).toEqual(['a', 'b']);
  });

  test('deleting a session clears incoming edges but keeps a fork source row', async () => {
    await createSessionRelation({ sessionId: 'parent', lifecycleOwnerSessionId: 'owner' });
    await createSessionRelation({ sessionId: 'child', parentSessionId: 'parent' });
    await createSessionRelation({
      sessionId: 'fork-1',
      sourceSessionId: 'parent',
      originKind: 'fork',
    });

    await deleteSessionRelations('parent');
    expect(await getSessionRelation('parent')).toBeNull();
    // The fork's own row survives; only its source edge is cleared.
    expect(await getSessionRelation('fork-1')).toMatchObject({
      sourceSessionId: null,
      originKind: null,
    });
    // A child is released to the root rather than left pointing at a dead id.
    expect(await getSessionRelation('child')).toMatchObject({
      parentSessionId: null,
      depth: 0,
    });
  });
});
