/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The workspace sync is a one-time BOOTSTRAP, and its gate is the whole point.
 *
 * The sync's input is every session file under `~/.omp/agent/sessions`, and a
 * session's cwd is whatever directory omp was spawned in — scratch directories
 * included. Without the gate, every scratch cwd that appeared after the user
 * had curated their sidebar became a new workspace folder on the next boot, and
 * deleting one only tombstoned the paths it had seen. Measured on the machine
 * this was written for: 556 session files, 43 distinct cwds, 33 of them scratch
 * (`/tmp/omp-*`, `/var/folders/.../T/opencode/*`, `$HOME`), and 88 folders the
 * user had already deleted.
 *
 * Two properties are pinned here, because each fails silently on its own:
 *
 * - a NON-EMPTY list is never appended to (the gate), and
 * - an EMPTY list is still seeded (the gate is not a no-op).
 *
 * `PI_CODING_AGENT_DIR` is read per call, so pointing it at a temp directory is
 * enough to redirect discovery — the same seam `blobs.server.test.ts` uses.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDb, type DbClient } from '@/server/lib/db/client';
import { syncWorkspaceFoldersFromDiscovery } from '@/server/lib/db/workspace-sync';
import { clearSessionFileCaches } from '@/server/lib/omp/session/files';
import { invalidateOmpSidebarData } from '@/server/lib/omp/session/reader';

const SCHEMA = `
  CREATE TABLE workspace_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    is_expanded BOOLEAN DEFAULT 0,
    project_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE deleted_workspaces (
    project_path TEXT PRIMARY KEY,
    deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

let agentDir = '';
let workRoot = '';

/**
 * Plant one omp session file for `cwd` under the agent dir, so discovery sees
 * that project. The header is all the scan needs to attribute a cwd.
 */
async function plantSession(id: string, cwd: string): Promise<void> {
  const slug = `-${cwd.replace(/[/:]/g, '-')}`;
  const dir = path.join(agentDir, 'sessions', slug);
  await fsp.mkdir(dir, { recursive: true });
  const lines = [
    { type: 'session', version: 3, id, cwd, timestamp: '2026-09-29T03:00:00.000Z' },
    {
      type: 'message',
      id: 'm-1',
      parentId: null,
      timestamp: '2026-09-29T03:00:01.000Z',
      message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    },
  ];
  await fsp.writeFile(
    path.join(dir, `2026-09-29T03-00-00-000Z_${id}.jsonl`),
    `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`,
  );
}

/** Drop both discovery caches so a just-planted session file is visible. */
function invalidateDiscovery(): void {
  clearSessionFileCaches();
  invalidateOmpSidebarData();
}

/** Every client this file opened, closed before the tree is deleted. */
const opened: DbClient[] = [];

/** A fresh database on its own file, so one test's rows cannot reach another. */
async function freshDb(name: string): Promise<DbClient> {
  const dbPath = path.join(workRoot, `${name}.sqlite`);
  const db = createDb(dbPath);
  opened.push(db);
  await db.exec(SCHEMA);
  return db;
}

async function folderPaths(db: DbClient): Promise<string[]> {
  const rows = await db.all<{ project_path: string }>(
    'SELECT project_path FROM workspace_folders ORDER BY id',
  );
  return rows.map((row) => row.project_path);
}

beforeAll(async () => {
  workRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'omp-workspace-sync-'));
  agentDir = path.join(workRoot, 'agent');
  process.env.PI_CODING_AGENT_DIR = agentDir;

  // Three discoverable projects: two real ones and one scratch directory, which
  // is the shape that produced the phantom folders.
  await plantSession('seed-1', '/Users/someone/JatisMobile/literasi-web');
  await plantSession('seed-2', '/Users/someone/JatisMobile/Workspace');
  await plantSession('seed-3', '/tmp/omp-scratch-run');
  invalidateDiscovery();
});

// The agent dir is process-wide env and the discovery caches are module state:
// another suite's temp fixtures must not answer this file's scan.
beforeEach(() => {
  process.env.PI_CODING_AGENT_DIR = agentDir;
  // omp prefers the XDG layout when `$XDG_DATA_HOME/omp` exists, and a sibling
  // suite's temp XDG root would answer this file's scan instead.
  delete process.env.XDG_DATA_HOME;
  invalidateDiscovery();
});

afterAll(async () => {
  delete process.env.PI_CODING_AGENT_DIR;
  invalidateDiscovery();
  // Close every connection before the tree goes: an open SQLite handle makes a
  // Windows delete fail with EBUSY, and a throw from `afterAll` reports a
  // failure of this file.
  for (const db of opened.splice(0)) db.raw.close();
  await fsp.rm(workRoot, { recursive: true, force: true });
});

describe('workspace folder sync', () => {
  test('seeds an empty list from discovery', async () => {
    const db = await freshDb('empty');
    expect(await syncWorkspaceFoldersFromDiscovery(db)).toBe(true);
    expect((await folderPaths(db)).sort()).toEqual([
      '/Users/someone/JatisMobile/Workspace',
      '/Users/someone/JatisMobile/literasi-web',
      '/tmp/omp-scratch-run',
    ]);
  });

  test('does not refill a list the user emptied', async () => {
    // The half the row count cannot see: an empty list is ALSO what a user who
    // deleted every folder leaves behind. The tombstone alone does not cover
    // it — a delete only tombstones the paths it saw, and the NEXT scratch
    // directory omp is spawned in has no tombstone to stop it.
    const db = await freshDb('emptied');
    expect(await syncWorkspaceFoldersFromDiscovery(db)).toBe(true);
    expect((await folderPaths(db)).length).toBe(3);

    // The user deletes everything.
    const paths = await folderPaths(db);
    for (const projectPath of paths) {
      await db.run('INSERT OR REPLACE INTO deleted_workspaces (project_path) VALUES (?)', [projectPath]);
      await db.run('DELETE FROM workspace_folders WHERE project_path = ?', [projectPath]);
    }
    expect(await folderPaths(db)).toEqual([]);

    // A NEW scratch session appears — a path no tombstone names. Without the
    // one-shot marker this is a fresh insert into a list the user emptied.
    await plantSession('later-scratch', '/tmp/omp-later-scratch');
    invalidateDiscovery();

    expect(await syncWorkspaceFoldersFromDiscovery(db)).toBe(false);
    expect(await folderPaths(db)).toEqual([]);
  });

  test('a pass that finds no project still counts as run', async () => {
    // Marking only on a successful insert would let the first session written
    // afterwards seed the list — the marker is about the ATTEMPT, not the rows.
    const db = await freshDb('no-projects');
    const emptyAgentDir = path.join(workRoot, 'agent-empty');
    await fsp.mkdir(path.join(emptyAgentDir, 'sessions'), { recursive: true });

    process.env.PI_CODING_AGENT_DIR = emptyAgentDir;
    invalidateDiscovery();
    // Nothing to discover, so nothing was inserted — but the bootstrap ran.
    expect(await syncWorkspaceFoldersFromDiscovery(db)).toBe(false);
    expect(await folderPaths(db)).toEqual([]);

    // Sessions exist again, and the list is still empty — the one run is spent.
    process.env.PI_CODING_AGENT_DIR = agentDir;
    invalidateDiscovery();
    expect(await syncWorkspaceFoldersFromDiscovery(db)).toBe(false);
    expect(await folderPaths(db)).toEqual([]);
  });

  test('does NOT append to a non-empty list', async () => {
    const db = await freshDb('curated');
    await db.run(
      'INSERT INTO workspace_folders (name, is_expanded, project_path) VALUES (?, 1, ?)',
      ['kabmo', '/Users/someone/JatisMobile/kabmo'],
    );

    expect(await syncWorkspaceFoldersFromDiscovery(db)).toBe(false);
    // The curated folder alone — the three discoverable projects stayed out.
    expect(await folderPaths(db)).toEqual(['/Users/someone/JatisMobile/kabmo']);
  });

  test('a pre-marker database records the run on its first boot', async () => {
    // The upgrade path: an install that has been running since before the
    // marker arrives with folders and no marker. Skipping without recording
    // would leave the "user deleted every folder" hole open for exactly the
    // installs that have been running longest.
    const db = await freshDb('upgrade');
    await db.run(
      'INSERT INTO workspace_folders (name, is_expanded, project_path) VALUES (?, 1, ?)',
      ['kabmo', '/Users/someone/JatisMobile/kabmo'],
    );
    expect(await syncWorkspaceFoldersFromDiscovery(db)).toBe(false);

    // The user then deletes their last folder; the spent marker holds.
    await db.run('DELETE FROM workspace_folders');
    expect(await syncWorkspaceFoldersFromDiscovery(db)).toBe(false);
    expect(await folderPaths(db)).toEqual([]);
  });

  test('an unbound folder also ends the bootstrap', async () => {
    // A folder with no project_path (`Chats`, a hand-made grouping) is still a
    // deliberate choice, and seeding beside it is the same surprise.
    const db = await freshDb('unbound');
    await db.run('INSERT INTO workspace_folders (name, is_expanded) VALUES (?, 1)', ['Chats']);

    expect(await syncWorkspaceFoldersFromDiscovery(db)).toBe(false);
    const rows = await db.all<{ project_path: string | null }>(
      'SELECT project_path FROM workspace_folders',
    );
    expect(rows).toEqual([{ project_path: null }]);
  });

  test('SYNC_WORKSPACE=false disables the seed entirely', async () => {
    const db = await freshDb('flag-off');
    Bun.env.SYNC_WORKSPACE = 'false';
    try {
      expect(await syncWorkspaceFoldersFromDiscovery(db)).toBe(false);
      expect(await folderPaths(db)).toEqual([]);
    } finally {
      delete Bun.env.SYNC_WORKSPACE;
    }
  });

  test('a tombstoned project stays deleted on a later seed', async () => {
    const db = await freshDb('tombstone');
    await db.run('INSERT OR REPLACE INTO deleted_workspaces (project_path) VALUES (?)', [
      '/Users/someone/JatisMobile/Workspace',
    ]);

    expect(await syncWorkspaceFoldersFromDiscovery(db)).toBe(true);
    expect(await folderPaths(db)).not.toContain('/Users/someone/JatisMobile/Workspace');
  });

  test('two projects sharing a basename get distinct names', async () => {
    // The sidebar's uniqueness rule is by NAME, and scratch directories share
    // basenames constantly (`/tmp/a/work`, `/tmp/b/work`).
    await plantSession('dup-1', '/tmp/omp-dup-a/work');
    await plantSession('dup-2', '/tmp/omp-dup-b/work');
    invalidateDiscovery();

    const db = await freshDb('dup-names');
    await syncWorkspaceFoldersFromDiscovery(db);
    const names = await db.all<{ name: string }>('SELECT name FROM workspace_folders');
    const work = names.filter((row) => row.name === 'work' || row.name.startsWith('work-'));
    expect(work.length).toBe(2);
    expect(new Set(work.map((row) => row.name)).size).toBe(2);
  });
});
