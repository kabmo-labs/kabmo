/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A sidebar row names the agent that ACTUALLY ran the chat.
 *
 * The bug this pins: every row reported `omp-rpc`, because the sidebar filled
 * `harness` from `DEFAULT_HARNESS_ID` and nothing ever wrote a record. The mark
 * beside a session name was therefore decorative — it said `omp` for a chat that
 * ran on `opencode2`, and a chat spawned over ACP did not appear in the list AT
 * ALL (its agent writes no session file, so omp's JSONL discovery cannot see it).
 *
 * Three properties are load-bearing:
 *
 *  - an ACP chat is listed from the persisted record, not from omp's scan;
 *  - it is filed under the folder that owns its cwd, resolved the same way the
 *    scan resolves a discovered session's;
 *  - the list is ordered as ONE sequence. Appending the ACP rows after omp's
 *    already-sorted bucket put a just-spawned chat below 240 older ones, behind
 *    "Show more".
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getDb } from '@/server/db.server';
import { loadSidebarStructure } from '@/server/lib/omp/session/sidebar-data.server';
import { invalidateOmpSidebarData } from '@/server/lib/omp/session/reader';
import { clearSessionFileCaches } from '@/server/lib/omp/session/files';
import { saveHarnessSession } from '@/server/lib/harness/session-store.server';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { removeDir } from '@/test-support/remove-dir';

/** The same budget the canonical suite states: `loadSidebarStructure` spawns
 *  `git worktree list` for any folder that has a session. */
setDefaultTimeout(30_000);

const saved = {
  agentDir: Bun.env.PI_CODING_AGENT_DIR,
  xdg: Bun.env.XDG_DATA_HOME,
  mock: Bun.env.MOCK,
  sync: Bun.env.SYNC_WORKSPACE,
};

let root = '';
let sessionsRoot = '';
let project = '';

beforeAll(async () => {
  root = await fs.promises.mkdtemp(join(tmpdir(), 'omc-sidebar-harness-'));
  const agent = join(root, 'agent');
  sessionsRoot = join(agent, 'sessions');
  await fs.promises.mkdir(sessionsRoot, { recursive: true });
  project = join(root, 'project');
  await fs.promises.mkdir(project, { recursive: true });

  Bun.env.PI_CODING_AGENT_DIR = agent;
  delete Bun.env.XDG_DATA_HOME;
  Bun.env.MOCK = 'false';
  Bun.env.SYNC_WORKSPACE = 'false';
});

afterAll(() => {
  if (saved.agentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = saved.agentDir;
  if (saved.xdg === undefined) delete Bun.env.XDG_DATA_HOME;
  else Bun.env.XDG_DATA_HOME = saved.xdg;
  if (saved.mock === undefined) delete Bun.env.MOCK;
  else Bun.env.MOCK = saved.mock;
  if (saved.sync === undefined) delete Bun.env.SYNC_WORKSPACE;
  else Bun.env.SYNC_WORKSPACE = saved.sync;
  removeDir(root);
});

beforeEach(async () => {
  await isolateDb();
  await fs.promises.rm(join(sessionsRoot, 'project'), { recursive: true, force: true });
  invalidateOmpSidebarData();
  clearSessionFileCaches();
});

afterEach(async () => {
  await releaseDb();
});

/** One omp session file, timestamped so ordering between cases is explicit. */
async function writeOmpSession(id: string, timestamp: string): Promise<void> {
  const dir = join(sessionsRoot, 'project');
  await fs.promises.mkdir(dir, { recursive: true });
  const lines = [
    JSON.stringify({ type: 'session', id, cwd: project, timestamp }),
    JSON.stringify({
      type: 'message', id: `${id}-m1`, parentId: null, timestamp,
      message: { role: 'user', content: `prompt for ${id}` },
    }),
  ];
  await Bun.write(join(dir, `${id}.jsonl`), `${lines.join('\n')}\n`);
}

async function registerFolder(projectPath: string): Promise<number> {
  const db = await getDb();
  await db.run('INSERT INTO workspace_folders (name, project_path) VALUES (?, ?)', ['ws', projectPath]);
  const row = await db.get<{ id: number }>('SELECT id FROM workspace_folders ORDER BY id DESC LIMIT 1');
  return Number(row?.id);
}

/** The folder row and its sessions, by folder id. */
async function folderSessions(folderId: number) {
  const structure = await loadSidebarStructure();
  const folder = structure.folders.find((entry) => Number(entry.id) === folderId);
  return folder?.sessions ?? [];
}

describe('a sidebar row names its harness', () => {
  test('an ACP chat is listed, with its own harness', async () => {
    const folderId = await registerFolder(project);
    await saveHarnessSession({
      sessionId: 'ses_acp', harness: 'opencode', agentSessionId: 'ses_acp', cwd: project,
    });

    const sessions = await folderSessions(folderId);
    const row = sessions.find((entry) => String(entry.id) === 'ses_acp');
    expect(row).toBeDefined();
    // The mark's own key: `opencode2` draws opencode's art, and the label names
    // which of the two it is.
    expect(row?.harness).toBe('opencode');
  });

  test('an omp session keeps the omp default, and does not appear twice', async () => {
    const folderId = await registerFolder(project);
    await writeOmpSession('omp-1', '2026-11-06T00:00:00.000Z');
    // omp rows are persisted too (their resume id lives there), so the ACP
    // listing must exclude them or one chat would draw two rows.
    await saveHarnessSession({
      sessionId: 'omp-1', harness: 'omp-rpc', agentSessionId: '', cwd: project,
    });

    const sessions = await folderSessions(folderId);
    const matches = sessions.filter((entry) => String(entry.id) === 'omp-1');
    expect(matches).toHaveLength(1);
    expect(matches[0].harness).toBe('omp-rpc');
  });

  test('the ACP row is interleaved by time, not appended to the end', async () => {
    const folderId = await registerFolder(project);
    await writeOmpSession('old-1', '2026-01-01T00:00:00.000Z');
    await writeOmpSession('old-2', '2026-01-02T00:00:00.000Z');
    // Newer than both omp files: it belongs at the TOP, which is what "Show
    // more" hid when the ACP rows were concatenated after the sorted bucket.
    await saveHarnessSession({
      sessionId: 'ses_new', harness: 'claude', agentSessionId: 'ses_new', cwd: project,
    });

    const sessions = await folderSessions(folderId);
    expect(String(sessions[0]?.id)).toBe('ses_new');
    expect(sessions).toHaveLength(3);
  });

  test('a chat whose cwd is outside every folder is filed under none', async () => {
    const folderId = await registerFolder(project);
    await saveHarnessSession({
      sessionId: 'ses_elsewhere', harness: 'pi', agentSessionId: 'ses_elsewhere',
      cwd: join(root, 'somewhere-else'),
    });

    const sessions = await folderSessions(folderId);
    expect(sessions.map((entry) => String(entry.id))).not.toContain('ses_elsewhere');
  });

  test('a harness this build no longer knows draws no mark, not a wrong one', async () => {
    const folderId = await registerFolder(project);
    await saveHarnessSession({
      sessionId: 'ses_gone', harness: 'some-future-agent', agentSessionId: 'ses_gone', cwd: project,
    });

    const sessions = await folderSessions(folderId);
    const row = sessions.find((entry) => String(entry.id) === 'ses_gone');
    expect(row).toBeDefined();
    // Absent, not fabricated: `HarnessGlyph` renders nothing for an unknown id.
    expect(row?.harness).toBeUndefined();
  });
});
