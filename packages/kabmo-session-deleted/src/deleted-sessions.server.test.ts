/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The deleted-session tombstone.
 *
 * The bug this pins: deleting an imported chat removed Kabmo's rows, the agent
 * kept its copy, and the next import put the chat back. The tombstone is the
 * durable answer — the delete writes the id, and the import and the sidebar
 * skip it.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { getDb } from '@/server/db.server';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { loadDeletedSessionIds, markSessionDeleted } from './deleted-sessions.server';

beforeEach(async () => {
  await isolateDb();
});

afterEach(async () => {
  await releaseDb();
});

describe('deleted session tombstones', () => {
  test('a marked id is loaded, and marking twice is a no-op', async () => {
    await markSessionDeleted('ses_gone');
    await markSessionDeleted('ses_gone');
    expect([...(await loadDeletedSessionIds())]).toEqual(['ses_gone']);
  });

  test('an empty id is not written', async () => {
    await markSessionDeleted('');
    expect((await loadDeletedSessionIds()).size).toBe(0);
  });

  test('the tombstone outlives the rows it was written with', async () => {
    const db = await getDb();
    await db.run('INSERT INTO harness_sessions (session_id, harness, agent_session_id, cwd, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)', [
      'ses_gone', 'opencode', '', '/tmp/project',
    ]);
    await markSessionDeleted('ses_gone');
    await db.run('DELETE FROM harness_sessions WHERE session_id = ?', ['ses_gone']);
    expect((await loadDeletedSessionIds()).has('ses_gone')).toBe(true);
  });
});
