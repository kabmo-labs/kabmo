/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Deleting a chat that ran on an ACP harness.
 *
 * An ACP agent writes no session file, so `harness_sessions` IS the row the
 * sidebar draws — and the delete flow used to purge only Kabmo's own tables.
 * Measured before the fix, both failure modes:
 *
 *   - a `claude` chat answered 404 "Session not found" and stayed in the
 *     sidebar (nothing matched, so the purge reported nothing to remove);
 *   - an `omp-acp` chat answered 200 and removed its JSONL, then reappeared
 *     from the record the very next sidebar build. Deleting an ARCHIVED ACP
 *     chat looked the same: the archive row was purged, the record was not, so
 *     the row came back unarchived — the reported "archive is undone by delete".
 *
 * The live child is looked up in the harness-agnostic registry now, so a busy
 * ACP chat is refused rather than removed underneath its own agent, and an idle
 * one is torn down before its rows go.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getDb } from '@/server/db.server';
import { saveHarnessSession } from '@/server/lib/harness/session-store.server';
import { clearSessionFileCaches } from '@/server/lib/omp/session/files';
import { invalidateOmpSidebarData } from '@/server/lib/omp/session/reader';
import { loadSidebarStructure } from '@/server/lib/omp/session/sidebar-data.server';
import { deleteSession } from '@/server/routes/sessions/delete';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { removeDir } from '@/test-support/remove-dir';

/** The sidebar build spawns `git worktree list` for a folder with sessions. */
setDefaultTimeout(30_000);

const saved = {
  agentDir: Bun.env.PI_CODING_AGENT_DIR,
  mock: Bun.env.MOCK,
  sync: Bun.env.SYNC_WORKSPACE,
};

let root = '';
let sessionsRoot = '';
let project = '';
let folderId = 0;

beforeAll(async () => {
  root = await fs.promises.mkdtemp(join(tmpdir(), 'omc-delete-acp-'));
  const agent = join(root, 'agent');
  sessionsRoot = join(agent, 'sessions');
  await fs.promises.mkdir(sessionsRoot, { recursive: true });
  project = join(root, 'project');
  await fs.promises.mkdir(project, { recursive: true });

  Bun.env.PI_CODING_AGENT_DIR = agent;
  Bun.env.MOCK = 'false';
  Bun.env.SYNC_WORKSPACE = 'false';
});

afterAll(async () => {
  if (saved.agentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = saved.agentDir;
  if (saved.mock === undefined) delete Bun.env.MOCK;
  else Bun.env.MOCK = saved.mock;
  if (saved.sync === undefined) delete Bun.env.SYNC_WORKSPACE;
  else Bun.env.SYNC_WORKSPACE = saved.sync;
  await releaseDb();
  removeDir(root);
});

beforeEach(async () => {
  await isolateDb();
  const db = await getDb();
  await db.run('INSERT INTO workspace_folders (name, project_path) VALUES (?, ?)', ['ws', project]);
  const row = await db.get<{ id: number }>('SELECT id FROM workspace_folders ORDER BY id DESC LIMIT 1');
  folderId = Number(row?.id);
  await fs.promises.rm(join(sessionsRoot, 'project'), { recursive: true, force: true });
  invalidateOmpSidebarData();
  clearSessionFileCaches();
});

async function deleteSessionRoute(sessionId: string): Promise<Response> {
  return (await deleteSession({
    request: new Request(`http://localhost/api/sessions/${sessionId}`, { method: 'DELETE' }),
    params: { sessionId },
  } as never)) as Response;
}

/** The row the sidebar would draw for this id, after a real rebuild. */
async function sidebarRow(sessionId: string) {
  invalidateOmpSidebarData();
  clearSessionFileCaches();
  const structure = await loadSidebarStructure();
  const folder = structure.folders.find((entry) => Number(entry.id) === folderId);
  return (folder?.sessions ?? []).find((entry) => String(entry.id) === sessionId);
}

/** One omp session file: the transcript `omp-acp` writes over ACP. */
async function writeOmpSession(id: string): Promise<void> {
  const dir = join(sessionsRoot, 'project');
  await fs.promises.mkdir(dir, { recursive: true });
  const now = new Date().toISOString();
  const lines = [
    JSON.stringify({ type: 'session', id, cwd: project, timestamp: now }),
    JSON.stringify({
      type: 'message', id: `${id}-m1`, parentId: null, timestamp: now,
      message: { role: 'user', content: 'hello' },
    }),
  ];
  await Bun.write(join(dir, `${id}.jsonl`), `${lines.join('\n')}\n`);
}

/** A live session in the shared registry, as a driver would have registered it. */
function registerLive(session: Record<string, unknown>): void {
  globalThis.__ompSessions ??= new Map();
  globalThis.__ompSessions.set(String(session.sessionId), session as never);
}

function forgetLive(sessionId: string): void {
  globalThis.__ompSessions?.delete(sessionId);
}

describe('deleting an ACP chat', () => {
  test('the record is the thing removed — a chat with no transcript is a 200, not a 404', async () => {
    const id = 'ses_acp_only';
    await saveHarnessSession({ sessionId: id, harness: 'opencode', agentSessionId: id, cwd: project });
    expect(await sidebarRow(id)).toBeDefined();

    const res = await deleteSessionRoute(id);
    expect(res.status).toBe(200);

    expect(await sidebarRow(id)).toBeUndefined();
    const db = await getDb();
    expect(await db.get('SELECT session_id FROM harness_sessions WHERE session_id = ?', [id])).toBeNull();
  });

  test('the goal and usage rows keyed to the chat go with it', async () => {
    const id = 'ses_acp_extras';
    await saveHarnessSession({ sessionId: id, harness: 'claude', agentSessionId: id, cwd: project });
    const db = await getDb();
    await db.run('INSERT INTO harness_goal_state (session_id, plan, updated_at) VALUES (?, 1, 1)', [id]);
    await db.run('INSERT INTO harness_usage_state (session_id, updated_at) VALUES (?, 1)', [id]);

    expect((await deleteSessionRoute(id)).status).toBe(200);

    // Same final rule as the composer's Context ring: a deleted chat has no
    // stored goal or usage left to answer from a reload.
    expect(await db.get('SELECT session_id FROM harness_goal_state WHERE session_id = ?', [id])).toBeNull();
    expect(await db.get('SELECT session_id FROM harness_usage_state WHERE session_id = ?', [id])).toBeNull();
  });

  test('an archived ACP chat disappears instead of coming back unarchived', async () => {
    const id = 'ses_acp_archived';
    await saveHarnessSession({ sessionId: id, harness: 'opencode', agentSessionId: id, cwd: project });
    const db = await getDb();
    await db.run('INSERT INTO archived_sessions (session_id) VALUES (?)', [id]);
    expect((await sidebarRow(id))?.is_archived).toBe(1);

    expect((await deleteSessionRoute(id)).status).toBe(200);

    // The row is GONE, not merely moved out of the archive view.
    expect(await sidebarRow(id)).toBeUndefined();
    expect(await db.all('SELECT session_id FROM archived_sessions WHERE session_id = ?', [id])).toEqual([]);
  });

  test('an `omp-acp` chat whose JSONL the scan found is not re-listed from its record', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    await writeOmpSession(id);
    await saveHarnessSession({ sessionId: id, harness: 'omp-acp', agentSessionId: id, cwd: project });
    expect(await sidebarRow(id)).toBeDefined();

    expect((await deleteSessionRoute(id)).status).toBe(200);

    expect(await sidebarRow(id)).toBeUndefined();
    expect(fs.existsSync(join(sessionsRoot, 'project', `${id}.jsonl`))).toBe(false);
  });

  test('a busy ACP chat is refused and left alive', async () => {
    const id = 'ses_acp_busy';
    await saveHarnessSession({ sessionId: id, harness: 'claude', agentSessionId: id, cwd: project });
    let destroyed = false;
    registerLive({
      sessionId: id,
      harness: 'claude',
      isAlive: () => true,
      isBusy: () => true,
      destroyAndWait: async () => { destroyed = true; },
    });

    try {
      const res = await deleteSessionRoute(id);
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: 'session_busy' });
      expect(destroyed).toBe(false);
      expect(await sidebarRow(id)).toBeDefined();
    } finally {
      forgetLive(id);
    }
  });

  test('an idle live ACP chat is torn down before its rows are purged', async () => {
    const id = 'ses_acp_idle';
    await saveHarnessSession({ sessionId: id, harness: 'claude', agentSessionId: id, cwd: project });
    let destroyed = false;
    registerLive({
      sessionId: id,
      harness: 'claude',
      isAlive: () => true,
      isBusy: () => false,
      destroyAndWait: async () => { destroyed = true; },
    });

    try {
      expect((await deleteSessionRoute(id)).status).toBe(200);
      expect(destroyed).toBe(true);
      expect(await sidebarRow(id)).toBeUndefined();
    } finally {
      forgetLive(id);
    }
  });
});
