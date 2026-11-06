/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The persisted harness of a session — what the sidebar's mark reads.
 *
 * The bug this pins: EVERY row was reported as `omp-rpc`, because the sidebar
 * filled the field from `DEFAULT_HARNESS_ID` and nothing ever wrote a record. A
 * session run on `opencode2` therefore drew omp's mark beside its name, so the
 * mark said nothing the reader could not already assume.
 *
 * The record has to survive what the live registry cannot: a restart, a closed
 * tab, a second Kabmo instance on the same database. That is why it is a table
 * and why every case here goes through the database rather than the `WeakMap`.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { getDb } from '@/server/db.server';
import {
  knownHarness,
  loadHarnessBySession,
  loadHarnessSession,
  saveHarnessSession,
} from '@/server/lib/harness/session-store.server';
import { ensureHarnessSchema } from '@/server/lib/harness/schema.server';
import { HARNESS_IDS } from '@/shared/lib/harness/catalog';

beforeEach(async () => {
  await isolateDb();
});

afterEach(async () => {
  await releaseDb();
});

afterAll(async () => {
  await releaseDb();
});

describe('harness session store', () => {
  test('a saved record is what the sidebar reads back', async () => {
    await saveHarnessSession({
      sessionId: 'sess-acp', harness: 'opencode', agentSessionId: 'agent-42', cwd: '/tmp/project',
    });

    const byId = await loadHarnessBySession();
    expect(byId.get('sess-acp')).toBe('opencode');

    const one = await loadHarnessSession('sess-acp');
    expect(one?.harness).toBe('opencode');
    // ACP may answer a DIFFERENT id than the one asked for, and resuming has to
    // send the AGENT's id — so it is stored beside ours, not instead of ours.
    expect(one?.agentSessionId).toBe('agent-42');
    expect(one?.cwd).toBe('/tmp/project');
  });

  test('a re-spawn UPDATES the row instead of failing on the primary key', async () => {
    await saveHarnessSession({ sessionId: 'sess-1', harness: 'claude', agentSessionId: '', cwd: '/a' });
    await saveHarnessSession({ sessionId: 'sess-1', harness: 'codex', agentSessionId: 'x', cwd: '/b' });

    const rows = (await (await getDb()).all('SELECT harness, cwd FROM harness_sessions WHERE session_id = ?', ['sess-1'])) as {
      harness: string; cwd: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].harness).toBe('codex');
    expect(rows[0].cwd).toBe('/b');
  });

  test('one read answers EVERY session, not one query per row', async () => {
    // The sidebar assembles hundreds of rows in one pass; a per-row query is the
    // difference between one read and one per session.
    for (const id of ['a', 'b', 'c']) {
      await saveHarnessSession({ sessionId: id, harness: 'omp-rpc', agentSessionId: '', cwd: '/p' });
    }
    const map = await loadHarnessBySession();
    expect([...map.keys()].sort()).toEqual(['a', 'b', 'c']);
    expect(map.get('b')).toBe('omp-rpc');
  });

  test('an unknown session is absent from the map, never guessed', async () => {
    await saveHarnessSession({ sessionId: 'known', harness: 'pi', agentSessionId: '', cwd: '/p' });
    const map = await loadHarnessBySession();
    expect(map.has('never-spawned')).toBe(false);
    expect(await loadHarnessSession('never-spawned')).toBeNull();
  });

  test('a harness this build does not know is refused, not drawn', async () => {
    // A row written by a newer build (an adapter since removed) would otherwise
    // draw an empty box with no name.
    expect(knownHarness('opencode', HARNESS_IDS)).toBe('opencode');
    // A row naming a harness this build no longer lists — `opencode2`, retired when
    // the preview became a shim for `opencode` — draws no mark rather than a wrong
    // one. Both spellings of "unknown" are covered: a retired id and an invented one.
    expect(knownHarness('opencode2', HARNESS_IDS)).toBeUndefined();
    expect(knownHarness('some-future-agent', HARNESS_IDS)).toBeUndefined();
    expect(knownHarness(undefined, HARNESS_IDS)).toBeUndefined();
  });

  test('the schema is idempotent, so every database open can run it', async () => {
    const db = await getDb();
    await saveHarnessSession({ sessionId: 's', harness: 'omp-rpc', agentSessionId: '', cwd: '/p' });
    // A second open re-runs `initSchema`; the row must survive it.
    await ensureHarnessSchema(db);
    expect((await loadHarnessBySession()).get('s')).toBe('omp-rpc');
  });
});
