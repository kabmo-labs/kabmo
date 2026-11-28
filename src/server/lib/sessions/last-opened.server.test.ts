/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The last-opened record: what a native shell is allowed to restore.
 *
 * Every case is a reason a cold start could land somewhere wrong — a pending
 * placeholder, a path-shaped id, a session the user archived or deleted — and
 * the assertion is always the same pair: the read refuses, AND the stale row is
 * gone, because a record that survives its session makes every later launch pay
 * the same failure again.
 *
 * The first case is the feature's whole reason for a client key: two installs
 * pointing at one console must not share a pointer.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { getDb } from '@/server/db.server';
import type { DbClient } from '@kabmo-labs/kabmo-db/client';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import {
  clearLastOpenedSession,
  lastOpenedSession,
  readLastOpenedSessionId,
  recordLastOpenedSession,
} from '@/server/lib/sessions/last-opened.server';

const SESSION_ID = '42';
const CLIENT = '11111111-2222-4333-8444-555555555555';
const OTHER_CLIENT = '99999999-8888-4777-8666-555555555555';
let db: DbClient;
let priorMock: string | undefined;

beforeAll(() => {
  priorMock = Bun.env.MOCK;
  Bun.env.MOCK = 'true';
});

beforeEach(async () => {
  await isolateDb();
  db = await getDb();
  // A mock session outside the seeded demo rows, so nothing else can answer
  // for it.
  await db.run("INSERT OR IGNORE INTO workspace_folders (id, name) VALUES (7, 'test')");
  await db.run('INSERT INTO sessions (id, folder_id, title) VALUES (?, 7, ?)', [SESSION_ID, 'Probe']);
});

afterEach(async () => {
  await releaseDb();
});

afterAll(() => {
  if (priorMock === undefined) delete Bun.env.MOCK;
  else Bun.env.MOCK = priorMock;
});

describe('lastOpenedSession', () => {
  test('no record yet means no session to restore', async () => {
    expect(await lastOpenedSession(CLIENT)).toBeNull();
  });

  test('a recorded session that still exists is restored', async () => {
    expect(await recordLastOpenedSession(CLIENT, SESSION_ID)).toBe(true);
    expect(await readLastOpenedSessionId(CLIENT)).toBe(SESSION_ID);
    expect(await lastOpenedSession(CLIENT)).toBe(SESSION_ID);
  });

  test('two clients keep separate pointers at one console', async () => {
    await recordLastOpenedSession(CLIENT, SESSION_ID);

    // The second install never opened anything, so it restores the landing even
    // though the first install has a record.
    expect(await lastOpenedSession(OTHER_CLIENT)).toBeNull();
    expect(await readLastOpenedSessionId(OTHER_CLIENT)).toBeNull();
  });

  test('an archived session is refused and its record cleared', async () => {
    await recordLastOpenedSession(CLIENT, SESSION_ID);
    await db.run('INSERT OR IGNORE INTO archived_sessions (session_id) VALUES (?)', [SESSION_ID]);

    expect(await lastOpenedSession(CLIENT)).toBeNull();
    expect(await readLastOpenedSessionId(CLIENT)).toBeNull();
  });

  test('a tombstoned session is refused and its record cleared', async () => {
    await recordLastOpenedSession(CLIENT, SESSION_ID);
    await db.run('INSERT OR IGNORE INTO deleted_sessions (session_id) VALUES (?)', [SESSION_ID]);

    expect(await lastOpenedSession(CLIENT)).toBeNull();
    expect(await readLastOpenedSessionId(CLIENT)).toBeNull();
  });

  test('an id that no longer exists is refused and its record cleared', async () => {
    await recordLastOpenedSession(CLIENT, SESSION_ID);
    await db.run('DELETE FROM sessions WHERE id = ?', [SESSION_ID]);

    expect(await lastOpenedSession(CLIENT)).toBeNull();
    expect(await readLastOpenedSessionId(CLIENT)).toBeNull();
  });

  test('clearing leaves the next launch on the empty workspace', async () => {
    await recordLastOpenedSession(CLIENT, SESSION_ID);
    await clearLastOpenedSession(CLIENT);
    expect(await lastOpenedSession(CLIENT)).toBeNull();
  });
});

describe('recordLastOpenedSession', () => {
  test('a pending chat is not a session to reopen', async () => {
    expect(await recordLastOpenedSession(CLIENT, 'new-1761000000000')).toBe(false);
    expect(await recordLastOpenedSession(CLIENT, '__new__01a0ff3d-0000-7000-8000-000000000000')).toBe(false);
    expect(await readLastOpenedSessionId(CLIENT)).toBeNull();
  });

  test('a value that is not one path segment is refused', async () => {
    for (const id of ['', '.', '..', 'a/b', 'a\\b']) {
      expect(await recordLastOpenedSession(CLIENT, id)).toBe(false);
    }
    expect(await readLastOpenedSessionId(CLIENT)).toBeNull();
  });

  test('a request with no client id records nothing', async () => {
    expect(await recordLastOpenedSession('', SESSION_ID)).toBe(false);
  });
});
