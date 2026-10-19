/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `MOCK=true` database seeding: demo workspace folders, screenshot-matching
 * chat sessions, the bundled sample transcripts and a synthetic file tree.
 * Split out of `@/server/db.server` so the connection lifecycle there stays
 * readable. Runs only in mock mode and only on a database that has not been
 * seeded before — every branch is idempotent, so a restart re-asserts the
 * demo rows instead of duplicating them.
 */

import type { DbClient } from '@/server/lib/db/client';
import { SAMPLE_TOOLS_SESSION_ID, getSampleToolsSession } from '@/client/data/samples/tools-session';
import { SAMPLE_DIALOGUE_SESSION_ID, getSampleDialogueSession } from '@/client/data/samples/dialogue-session';
import { SAMPLE_DEVICES_SESSION_ID, getSampleDevicesSession } from '@/client/data/samples/virtual-devices-session';

const INSERT_CHAT_SESSION =
  'INSERT OR REPLACE INTO chat_sessions (session_id, title, messages, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)';

export async function seedMockData(db: DbClient): Promise<void> {
  const folderCount = await db.get('SELECT COUNT(*) as count FROM workspace_folders');

  if (folderCount.count === 0) {
    await db.exec(`
      INSERT OR IGNORE INTO workspace_folders (id, name, is_expanded) VALUES 
        (1, 'Chats', 1), 
        (2, 'Workspace', 1), 
        (3, 'drrealhandler', 1);
    `);
  }

  await seedChatSessions(db);
  await seedWorkspaceSessions(db, 2, [
    'History Commit 2026-09-05 23:00',
    'History Commit 2026-09-04 23:00',
    'History Commit 2026-09-03 23:00',
    'Error SMSC latency pada jns6.5 smppv2',
    'Penyebab provider_submit_status=-1 di jns6.5 Smartfren SMPP',
    'jns6.5 filevalidator error Mask Code di Release',
    'Union query transaksi 202607 dan 202606',
  ]);
  await seedWorkspaceSessions(db, 3, [
    'Buat branch feat/add-provider-err-telco-to-dr-smpp',
    'Update wiki v1.5.0 & testing dari add-configurabel',
    'Konfigurasi rute DR SMPP via config lookup',
    'drrealhandler update v1.5.0',
    'Gitlab wiki clone isi kosong',
  ]);

  await seedFillerSessions(db);
  await seedSessionFiles(db);
}

/** Demo folders 1-3 and the five sessions the sidebar screenshots show. */
async function seedChatSessions(db: DbClient): Promise<void> {
  // Ensure kabmo, Workspace, drrealhandler folders exist
  await db.run("INSERT OR IGNORE INTO workspace_folders (id, name, is_expanded) VALUES (1, 'kabmo', 1)");
  await db.run("INSERT OR IGNORE INTO workspace_folders (id, name, is_expanded) VALUES (2, 'Workspace', 1)");
  await db.run("INSERT OR IGNORE INTO workspace_folders (id, name, is_expanded) VALUES (3, 'drrealhandler', 1)");
  await db.run("UPDATE workspace_folders SET name = 'kabmo' WHERE id = 1");

  const existingChats = await db.all("SELECT * FROM sessions WHERE folder_id = 1");
  const titles = [
    'Cek stream subagent di ompweb',
    'Fitur Diff Panel dan Git Status Files',
    'Implementasi Saved State UI per Session ID',
    'Review loading indicator, model & intent title',
    'Status fitur streer dan queue',
  ];

  if (existingChats.length === 0) {
    await db.run("INSERT INTO sessions (folder_id, title, is_active) VALUES (1, ?, 0)", [titles[0]]);
    await db.run("INSERT INTO sessions (folder_id, title, is_active) VALUES (1, ?, 0)", [titles[1]]);
    await db.run("INSERT INTO sessions (folder_id, title, is_active) VALUES (1, ?, 1)", [titles[2]]);
    await db.run("INSERT INTO sessions (folder_id, title, is_active) VALUES (1, ?, 0)", [titles[3]]);
    await db.run("INSERT INTO sessions (folder_id, title, is_active) VALUES (1, ?, 0)", [titles[4]]);
  } else {
    await db.run("UPDATE sessions SET title = ? WHERE id = 1", [titles[0]]);
    await db.run("UPDATE sessions SET title = ? WHERE id = 2", [titles[1]]);
    await db.run("UPDATE sessions SET title = ? WHERE id = 3", [titles[2]]);
    await db.run("UPDATE sessions SET title = ? WHERE id = 4", [titles[3]]);
    await db.run("UPDATE sessions SET title = ? WHERE id = 5", [titles[4]]);
    await db.run("UPDATE sessions SET is_active = 0 WHERE folder_id = 1");
    await db.run("UPDATE sessions SET is_active = 1 WHERE id = 3");
  }

  // Pre-seed sample sessions data
  try {
    const s1 = getSampleToolsSession();
    await db.run(INSERT_CHAT_SESSION, ['1', s1.title, JSON.stringify(s1.messages)]);
    await db.run(INSERT_CHAT_SESSION, [SAMPLE_TOOLS_SESSION_ID, s1.title, JSON.stringify(s1.messages)]);

    const s2 = getSampleDialogueSession();
    await db.run(INSERT_CHAT_SESSION, ['2', s2.title, JSON.stringify(s2.messages)]);
    await db.run(INSERT_CHAT_SESSION, [SAMPLE_DIALOGUE_SESSION_ID, s2.title, JSON.stringify(s2.messages)]);

    const s3 = getSampleDevicesSession();
    await db.run(INSERT_CHAT_SESSION, ['3', s3.title, JSON.stringify(s3.messages)]);
    await db.run(INSERT_CHAT_SESSION, [SAMPLE_DEVICES_SESSION_ID, s3.title, JSON.stringify(s3.messages)]);
    const s3Row = await db.get("SELECT id FROM sessions WHERE folder_id = 1 AND title = ?", [titles[2]]);
    if (s3Row) {
      await db.run(INSERT_CHAT_SESSION, [String(s3Row.id), s3.title, JSON.stringify(s3.messages)]);
    }
  } catch (e) {
    console.error('Failed to pre-seed sample sessions:', e);
  }
}

/** Add the given session titles to a folder when it has none yet. */
async function seedWorkspaceSessions(db: DbClient, folderId: number, titles: string[]): Promise<void> {
  const existing = await db.all('SELECT * FROM sessions WHERE folder_id = ?', [folderId]);
  if (existing.length > 0) return;
  for (const title of titles) {
    await db.run('INSERT INTO sessions (folder_id, title, is_active) VALUES (?, ?, 0)', [folderId, title]);
  }
}

/** Add random sessions if we don't have enough to demonstrate the UI. */
async function seedFillerSessions(db: DbClient): Promise<void> {
  const sessionCount = await db.get('SELECT COUNT(*) as count FROM sessions');
  if (sessionCount.count >= 15) return;

  const titles = [
    'Fix header styling issue', 'Implement authentication flow', 'Setup CI/CD pipeline',
    'Debug database connection', 'Update README.md docs', 'Refactor UI components',
  ];
  for (let i = 1; i <= 3; i++) {
    for (let j = 0; j < 3; j++) {
      const title = titles[Math.floor(Math.random() * titles.length)] + ' #' + Math.floor(Math.random() * 1000);
      await db.run('INSERT INTO sessions (folder_id, title, is_active) VALUES (?, ?, 0)', [i, title]);
    }
  }
}

/** Seed a demo file tree for every session when the files table is empty. */
async function seedSessionFiles(db: DbClient): Promise<void> {
  const fileCount = await db.get('SELECT COUNT(*) as count FROM files');
  if (fileCount.count !== 0) return;

  const insertFile =
    'INSERT INTO files (session_id, parent_id, name, type, is_expanded) VALUES (?, ?, ?, ?, ?)';
  const allSessions = await db.all('SELECT id FROM sessions');
  for (const session of allSessions) {
    const src = await db.run(insertFile, [session.id, null, 'src', 'folder', 1]);
    const components = await db.run(insertFile, [session.id, null, 'components', 'folder', 0]);

    await db.run(insertFile, [session.id, src.lastID, 'index.tsx', 'file', 0]);
    await db.run(insertFile, [session.id, src.lastID, 'App.tsx', 'file', 0]);
    await db.run(insertFile, [session.id, src.lastID, 'styles.css', 'file', 0]);

    await db.run(insertFile, [session.id, components.lastID, 'Button.tsx', 'file', 0]);
    await db.run(insertFile, [session.id, components.lastID, 'Header.tsx', 'file', 0]);

    await db.run(insertFile, [session.id, null, 'package.json', 'file', 0]);
    await db.run(insertFile, [session.id, null, 'README.md', 'file', 0]);
  }
}
