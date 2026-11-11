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
  loadAcpSessions,
  loadHarnessBySession,
  loadHarnessSession,
  repointHarnessSession,
  saveHarnessSession,
  saveHarnessSessionTitle,
  saveHarnessSessionTitleIfEmpty,
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

  test('a well-formed id is kept even without a descriptor, a malformed one is not', async () => {
    expect(knownHarness('opencode', HARNESS_IDS)).toBe('opencode');
    // A user-added harness has no static descriptor, and a REMOVED one never
    // will: dropping the id would rewrite the chat's harness to `omp-rpc` and
    // resume it against the wrong agent. The id is kept; the launch path is what
    // refuses in words.
    expect(knownHarness('opencode2', HARNESS_IDS)).toBe('opencode2');
    expect(knownHarness('some-future-agent', HARNESS_IDS)).toBe('some-future-agent');
    expect(knownHarness('Not An Id', HARNESS_IDS)).toBeUndefined();
    expect(knownHarness(undefined, HARNESS_IDS)).toBeUndefined();
  });

  test('the schema is idempotent, so every database open can run it', async () => {
    const db = await getDb();
    await saveHarnessSession({ sessionId: 's', harness: 'omp-rpc', agentSessionId: '', cwd: '/p' });
    // A second open re-runs `initSchema`; the row must survive it.
    await ensureHarnessSchema(db);
    expect((await loadHarnessBySession()).get('s')).toBe('omp-rpc');
  });

  test('a title survives a re-spawn, which must not blank it', async () => {
    await saveHarnessSession({ sessionId: 'titled', harness: 'claude', agentSessionId: '', cwd: '/p' });
    await saveHarnessSessionTitleIfEmpty('titled', 'Plan the release');
    // A re-spawn UPDATES the row; the name it already carries is not part of
    // that write, so it must still be there afterwards.
    await saveHarnessSession({ sessionId: 'titled', harness: 'claude', agentSessionId: 'agent-9', cwd: '/p' });

    const [row] = await loadAcpSessions();
    expect(row.title).toBe('Plan the release');
  });

  test('the first prompt names the chat, and a later one cannot rename it', async () => {
    await saveHarnessSession({ sessionId: 'first', harness: 'opencode', agentSessionId: '', cwd: '/p' });

    expect(await saveHarnessSessionTitleIfEmpty('first', 'First prompt')).toBe(true);
    // A steering message, a queue delivery and a retry all reach this call with
    // their own text; none of them may rename the chat.
    expect(await saveHarnessSessionTitleIfEmpty('first', 'Second prompt')).toBe(false);

    const [row] = await loadAcpSessions();
    expect(row.title).toBe('First prompt');
  });

  test('the AGENT’s own title outranks the first prompt', async () => {
    await saveHarnessSession({ sessionId: 'named', harness: 'claude', agentSessionId: '', cwd: '/p' });
    await saveHarnessSessionTitleIfEmpty('named', 'raw first prompt');

    expect(await saveHarnessSessionTitle('named', 'Release planning')).toBe(true);
    // An agent that re-sends the same title must not republish the sidebar.
    expect(await saveHarnessSessionTitle('named', 'Release planning')).toBe(false);

    const [row] = await loadAcpSessions();
    expect(row.title).toBe('Release planning');
  });

  test('a title for a session nobody recorded is a no-op, not a new row', async () => {
    expect(await saveHarnessSessionTitleIfEmpty('ghost', 'anything')).toBe(false);
    expect(await saveHarnessSessionTitle('ghost', 'anything')).toBe(false);
    expect(await loadHarnessSession('ghost')).toBeNull();
  });

  test('a FORKING resume leaves one row: the chat keeps its id', async () => {
    await saveHarnessSession({ sessionId: 'chat-1', harness: 'claude', agentSessionId: 'agent-1', cwd: '/p' });
    // `session/load` answered a new id, and the spawn recorded it as its own row.
    await saveHarnessSession({ sessionId: 'agent-2', harness: 'claude', agentSessionId: '', cwd: '/p' });

    await repointHarnessSession('chat-1', 'agent-2');

    const rows = await loadAcpSessions();
    // Measured before this: a resumed claude chat drew TWO sidebar rows, an empty
    // twin beside the conversation the tab and the transcript are keyed by.
    expect(rows.map((row) => row.sessionId)).toEqual(['chat-1']);
    // The agent's id is the one the NEXT load must send.
    expect(rows[0].agentSessionId).toBe('agent-2');
  });

  test('a load that keeps the id changes nothing', async () => {
    await saveHarnessSession({ sessionId: 'chat-2', harness: 'claude', agentSessionId: 'chat-2', cwd: '/p' });
    await repointHarnessSession('chat-2', 'chat-2');
    expect((await loadAcpSessions()).map((row) => row.sessionId)).toEqual(['chat-2']);
  });
});
