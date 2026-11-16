/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The tree rule, pinned.
 *
 * These cases are the contract the agent token gate relies on: a worker may
 * reach its coordinator, a coordinator may reach its workers, and a sibling is
 * a different branch. The fork case is here because a fork row has a SOURCE
 * edge and no parent edge — a walk that ignored `origin_kind` would let a
 * source's parent address the fork.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { getDb } from '@/server/db.server';
import { ensureSessionRelationsSchema } from '@/server/lib/sessions/schema.server';
import { resolveAgentAccess } from '@/server/lib/sessions/relation-access.server';

async function relation(
  sessionId: string,
  parentSessionId: string | null,
  sourceSessionId: string | null = null,
): Promise<void> {
  const db = await getDb();
  await db.run(
    `INSERT INTO session_relations
       (session_id, parent_session_id, source_session_id, origin_kind, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [sessionId, parentSessionId, sourceSessionId, sourceSessionId ? 'fork' : null, Date.now()],
  );
}

beforeEach(async () => {
  await isolateDb();
  await ensureSessionRelationsSchema(await getDb());
  // C is the orchestrator; W1/W2 are its workers; H1 is W1's helper; F is a fork
  // of W1, which therefore has no parent edge.
  await relation('C', null);
  await relation('W1', 'C');
  await relation('W2', 'C');
  await relation('H1', 'W1');
  await relation('F', null, 'W1');
});

afterEach(async () => {
  await releaseDb();
});

describe('agent access follows the session tree', () => {
  test('a session may act on itself', async () => {
    expect(await resolveAgentAccess('C', 'C')).toBe('self');
  });

  test('a coordinator may act on its workers and their helpers', async () => {
    expect(await resolveAgentAccess('C', 'W1')).toBe('descendant');
    expect(await resolveAgentAccess('C', 'H1')).toBe('descendant');
  });

  test('a worker may act on its coordinator and grandparent', async () => {
    expect(await resolveAgentAccess('W1', 'C')).toBe('ancestor');
    expect(await resolveAgentAccess('H1', 'C')).toBe('ancestor');
    expect(await resolveAgentAccess('H1', 'W1')).toBe('ancestor');
  });

  test('a sibling is a different branch', async () => {
    expect(await resolveAgentAccess('W1', 'W2')).toBeNull();
    expect(await resolveAgentAccess('W2', 'H1')).toBeNull();
  });

  test('a fork is not reachable through its source', async () => {
    expect(await resolveAgentAccess('C', 'F')).toBeNull();
    expect(await resolveAgentAccess('W1', 'F')).toBeNull();
  });

  test('an unknown session is not in anyone’s tree', async () => {
    expect(await resolveAgentAccess('X', 'C')).toBeNull();
    expect(await resolveAgentAccess('C', 'X')).toBeNull();
  });

  test('a session with no relation row is a root', async () => {
    expect(await resolveAgentAccess('ROOT', 'C')).toBeNull();
    expect(await resolveAgentAccess('C', 'ROOT')).toBeNull();
  });

  test('a cyclic row terminates instead of hanging', async () => {
    // Corrupt data, not a legal tree: the depth guard is what keeps the walk
    // finite. A policy check inside the recursion would hang here.
    const db = await getDb();
    await db.run("UPDATE session_relations SET parent_session_id = 'H1' WHERE session_id = 'C'");
    expect(await resolveAgentAccess('C', 'W2')).toBe('descendant');
    expect(await resolveAgentAccess('W2', 'C')).toBe('ancestor');
  });
});
