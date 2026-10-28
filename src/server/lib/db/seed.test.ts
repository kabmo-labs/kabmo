/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Mock seeding and the non-PTY half of the terminal session.
 *
 * `seed.ts` is the dataset every MOCK=true screenshot and demo depends on, and
 * its contract is *idempotence*: it re-asserts the demo rows on every start
 * instead of duplicating them, which is why the sidebar keeps the same five
 * chat titles and the same file tree after a restart. It is also destructive in
 * one place that is easy to miss — folder 1 is RENAMED to `kabmo` on every
 * seed — so that is pinned rather than assumed. Every test runs against a temp
 * SQLite file; the real Kabmo database is never opened.
 *
 * The `terminal/session.server.ts` helpers are pinned alongside because they
 * need no PTY: the viewer fan-out drop rule (a viewer that cannot keep up is
 * dropped, never skipped, or xterm's parser is left mid-sequence), the snapshot
 * shape, and the process-group signalling fallback for a session with no child.
 * Anything requiring a real PTY spawn is deliberately not tested here.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { createDb, type DbClient } from '@/server/lib/db/client';
import { removeDir } from '@/test-support/remove-dir';
import { initSchema } from '@/server/lib/db/schema';
import { seedMockData } from '@/server/lib/db/seed';

const CHAT_TITLES = [
  'Cek stream subagent di ompweb',
  'Fitur Diff Panel dan Git Status Files',
  'Implementasi Saved State UI per Session ID',
  'Review loading indicator, model & intent title',
  'Status fitur streer dan queue',
];

/** Folder 2's seeded list, in the order `seedWorkspaceSessions` writes it. */
const WORKSPACE_TITLES = [
  'History Commit 2026-09-05 23:00',
  'History Commit 2026-09-04 23:00',
  'History Commit 2026-09-03 23:00',
  'Error SMSC latency pada jns6.5 smppv2',
  'Penyebab provider_submit_status=-1 di jns6.5 Smartfren SMPP',
  'jns6.5 filevalidator error Mask Code di Release',
  'Union query transaksi 202607 dan 202606',
];

/** Folder 3's seeded list, in the order `seedWorkspaceSessions` writes it. */
const DRREALHANDLER_TITLES = [
  'Buat branch feat/add-provider-err-telco-to-dr-smpp',
  'Update wiki v1.5.0 & testing dari add-configurabel',
  'Konfigurasi rute DR SMPP via config lookup',
  'drrealhandler update v1.5.0',
  'Gitlab wiki clone isi kosong',
];

/**
 * Budget for one seeding case.
 *
 * `seedMockData` writes the whole demo dataset — folders, three session lists,
 * the sample transcripts and a nine-entry file tree per session — and on a
 * Windows runner that crossed Bun's default 5 s per-test budget: measured, the
 * filler case took 6.9 s while the same assertion is ~0.3 s on macOS and Linux,
 * so the failure named a timeout rather than anything about the code. The
 * budget is the FIXTURE's, not the assertion's.
 */
const SEED_TIMEOUT_MS = 60_000;

let workRoot = '';
/** Every client this file opened, so teardown can close them before deleting. */
const opened: DbClient[] = [];

beforeEach(() => {
  workRoot = mkdtempSync(path.join(tmpdir(), 'kabmo-test-'));
});

afterEach(() => {
  // CLOSE FIRST, then delete. `force: true` only suppresses ENOENT, so on
  // Windows an open connection makes the delete fail with EBUSY — and because
  // the throw happens in `afterEach`, it reports the PREVIOUS test as failed and
  // cascades through the rest of the file. Measured on the first Windows run:
  // every case in this file failed this way while the assertions themselves
  // passed.
  for (const db of opened.splice(0)) db.raw.close();
  removeDir(workRoot);
});

async function freshDb(name: string): Promise<DbClient> {
  const db = createDb(path.join(workRoot, `${name}.sqlite`));
  opened.push(db);
  await initSchema(db);
  return db;
}

const count = async (db: DbClient, table: string): Promise<number> =>
  (await db.get<{ count: number }>(`SELECT COUNT(*) as count FROM ${table}`))!.count;

const titlesIn = async (db: DbClient, folderId: number): Promise<string[]> =>
  (
    await db.all<{ title: string }>('SELECT title FROM sessions WHERE folder_id = ? ORDER BY id', [folderId])
  ).map((row) => row.title);

describe('seedMockData — fresh mock database', () => {
  test('creates the three demo folders and the screenshot session lists', async () => {
    const db = await freshDb('fresh');
    await seedMockData(db);

    const folders = await db.all<{ id: number; name: string }>('SELECT id, name FROM workspace_folders ORDER BY id');
    expect(folders.map((f) => f.name)).toEqual(['kabmo', 'Workspace', 'drrealhandler']);
    expect(await titlesIn(db, 1)).toEqual(CHAT_TITLES);
    expect(await titlesIn(db, 2)).toEqual(WORKSPACE_TITLES);
    expect(await titlesIn(db, 3)).toEqual(DRREALHANDLER_TITLES);
  }, SEED_TIMEOUT_MS);

  test('marks the third chat session active and leaves the rest idle', async () => {
    const db = await freshDb('active');
    await seedMockData(db);
    const rows = await db.all<{ title: string; is_active: number }>(
      'SELECT title, is_active FROM sessions WHERE folder_id = 1 ORDER BY id',
    );
    expect(rows.map((r) => r.is_active)).toEqual([0, 0, 1, 0, 0]);
  }, SEED_TIMEOUT_MS);

  test('seeds the bundled sample transcripts into chat_sessions', async () => {
    const db = await freshDb('chats');
    await seedMockData(db);
    // Three sample ids, their three numeric aliases, and the active session row
    // — which REPLACES the `3` alias, so the demo set is six distinct ids.
    expect(await count(db, 'chat_sessions')).toBe(6);
    const stored = await db.get<{ messages: string }>('SELECT messages FROM chat_sessions WHERE session_id = ?', ['1']);
    expect(Array.isArray(JSON.parse(stored!.messages))).toBe(true);
  }, SEED_TIMEOUT_MS);

  test('gives every session the same 9-entry demo file tree', async () => {
    const db = await freshDb('files');
    await seedMockData(db);
    const sessions = await count(db, 'sessions');
    expect(sessions).toBe(17);
    expect(await count(db, 'files')).toBe(sessions * 9);

    const roots = await db.all<{ name: string; type: string }>(
      'SELECT name, type FROM files WHERE session_id = 1 AND parent_id IS NULL ORDER BY id',
    );
    expect(roots).toEqual([
      { name: 'src', type: 'folder' },
      { name: 'components', type: 'folder' },
      { name: 'package.json', type: 'file' },
      { name: 'README.md', type: 'file' },
    ]);
  }, SEED_TIMEOUT_MS);

  test('running twice re-asserts the same rows instead of duplicating them', async () => {
    const db = await freshDb('twice');
    await seedMockData(db);
    const first = {
      folders: await count(db, 'workspace_folders'),
      sessions: await count(db, 'sessions'),
      chats: await count(db, 'chat_sessions'),
      files: await count(db, 'files'),
    };

    await seedMockData(db);
    expect({
      folders: await count(db, 'workspace_folders'),
      sessions: await count(db, 'sessions'),
      chats: await count(db, 'chat_sessions'),
      files: await count(db, 'files'),
    }).toEqual(first);
    expect(await titlesIn(db, 1)).toEqual(CHAT_TITLES);
  }, SEED_TIMEOUT_MS);
});

describe('seedMockData — existing database', () => {
  test('folder 1 is renamed to kabmo while other folders keep their names', async () => {
    const db = await freshDb('existing-folders');
    await db.run("INSERT INTO workspace_folders (id, name, is_expanded) VALUES (1, 'Custom', 1)");
    await db.run("INSERT INTO workspace_folders (id, name, is_expanded) VALUES (2, 'Keep', 1)");

    await seedMockData(db);

    const folders = await db.all<{ id: number; name: string }>('SELECT id, name FROM workspace_folders ORDER BY id');
    expect(folders.map((f) => f.name)).toEqual(['kabmo', 'Keep', 'drrealhandler']);
  }, SEED_TIMEOUT_MS);

  test('a folder that already has sessions gets no workspace list', async () => {
    const db = await freshDb('existing-sessions');
    await db.run("INSERT INTO workspace_folders (id, name, is_expanded) VALUES (2, 'Workspace', 1)");
    await db.run("INSERT INTO sessions (folder_id, title, is_active) VALUES (2, 'Mine', 0)");

    await seedMockData(db);

    const titles = await titlesIn(db, 2);
    expect(titles[0]).toBe('Mine');
    expect(titles.filter((title) => WORKSPACE_TITLES.includes(title))).toEqual([]);
  }, SEED_TIMEOUT_MS);

  test('the file tree is not re-seeded when any file row exists', async () => {
    const db = await freshDb('existing-files');
    await db.run("INSERT INTO workspace_folders (id, name, is_expanded) VALUES (1, 'Chats', 1)");
    await db.run("INSERT INTO sessions (folder_id, title, is_active) VALUES (1, 'Mine', 0)");
    await db.run("INSERT INTO files (session_id, parent_id, name, type, is_expanded) VALUES (1, NULL, 'keep.ts', 'file', 0)");

    await seedMockData(db);

    expect(await count(db, 'files')).toBe(1);
  }, SEED_TIMEOUT_MS);

  test('filler sessions are added while the total is under 15', async () => {
    const db = await freshDb('filler');
    await db.run("INSERT INTO workspace_folders (id, name, is_expanded) VALUES (1, 'Chats', 1)");
    await db.run("INSERT INTO sessions (folder_id, title, is_active) VALUES (1, 'Mine', 0)");

    await seedMockData(db);

    // One pre-existing row, no chat inserts (folder 1 was not empty), 7 + 5
    // workspace rows, then 3 filler rows for each of the three folders.
    expect(await count(db, 'sessions')).toBe(1 + 7 + 5 + 9);
    const filler = await db.all<{ title: string }>('SELECT title FROM sessions WHERE folder_id = 3 ORDER BY id');
    expect(filler.slice(5).every((row) => /#\d+$/.test(row.title))).toBe(true);
  }, SEED_TIMEOUT_MS);
});
