/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pins the workspace-folder settings boundary: the row -> config projection,
 * the untrusted JSON -> patch parser, the partial UPDATE builder and the
 * destructive folder delete. A mistake here is user-visible (a cleared path,
 * a lost accent, a folder deleted without its sessions) and irreversible, so
 * each branch gets a case. The legacy-project migration is pinned too: it must
 * write once, respect its marker, and never re-run over a current database.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { createDb, type DbClient } from '@/server/lib/db/client';
import {
  deleteWorkspaceFolder,
  parseFolderSettingsPatch,
  projectConfigFromFolder,
  updateWorkspaceFolder,
  type WorkspaceFolderRow,
} from '@/shared/lib/workspace/project-settings';
import { migrateLegacyProjectSettings } from '@/shared/lib/workspace/project-settings-migration';
import { removeDir } from '@/test-support/remove-dir';

const SCHEMA = `
  CREATE TABLE workspace_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    project_path TEXT,
    model TEXT,
    accent_color TEXT,
    icon TEXT,
    custom_icon_url TEXT,
    is_pinned INTEGER DEFAULT 0,
    is_expanded INTEGER DEFAULT 0
  );
  CREATE TABLE sessions (id TEXT PRIMARY KEY, folder_id INTEGER);
  CREATE TABLE files (id TEXT PRIMARY KEY, session_id TEXT);
  CREATE TABLE deleted_workspaces (project_path TEXT PRIMARY KEY);
  CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

let workRoot = '';
let dbCounter = 0;
beforeAll(() => {
  workRoot = mkdtempSync(path.join(os.tmpdir(), 'omp-project-settings-'));
});
/** Connections this file opened; closed first (Windows EBUSY on delete). */
const opened: DbClient[] = [];
afterAll(() => {
  for (const db of opened.splice(0)) db.raw.close();
  removeDir(workRoot);
});
/** A fresh database so one test's rows cannot reach another. */
async function freshDb(): Promise<DbClient> {
  const db = createDb(path.join(workRoot, `db-${dbCounter++}.sqlite`));
  opened.push(db);
  await db.exec(SCHEMA);
  return db;
}

async function insertFolder(db: DbClient, name: string, projectPath: string | null): Promise<number> {
  const result = await db.run('INSERT INTO workspace_folders (name, project_path) VALUES (?, ?)', [name, projectPath]);
  return result.lastID;
}

async function folderRow(db: DbClient, id: number): Promise<Record<string, unknown> | undefined> {
  return db.get('SELECT * FROM workspace_folders WHERE id = ?', [id]);
}

describe('projectConfigFromFolder', () => {
  test('maps a fully populated row', () => {
    const row: WorkspaceFolderRow = {
      id: 7,
      name: 'kabmo',
      project_path: '/work/kabmo',
      model: 'DeepSeek-V3',
      accent_color: '#38bdf8',
      icon: 'code',
      custom_icon_url: 'https://cdn/icon.png',
      is_pinned: 1,
      is_expanded: 1,
    };
    expect(projectConfigFromFolder(row)).toEqual({
      id: 'folder-7',
      folderId: 7,
      name: 'kabmo',
      path: '/work/kabmo',
      model: 'DeepSeek-V3',
      accentColor: '#38bdf8',
      icon: 'code',
      customIconUrl: 'https://cdn/icon.png',
      isPinned: true,
      isExpanded: true,
    });
  });

  test('substitutes documented defaults for null/empty columns', () => {
    const config = projectConfigFromFolder({ id: 3, name: 'bare' });
    expect(config).toEqual({
      id: 'folder-3',
      folderId: 3,
      name: 'bare',
      path: '',
      model: 'Not selected',
      accentColor: '',
      icon: 'default',
      customIconUrl: undefined,
      isPinned: false,
      isExpanded: false,
    });
  });

  test('only the literal 1 flags pinned/expanded, and an empty icon url is dropped', () => {
    const config = projectConfigFromFolder({
      id: 1,
      name: 'x',
      is_pinned: 0,
      is_expanded: null,
      custom_icon_url: '',
    });
    expect(config.isPinned).toBe(false);
    expect(config.isExpanded).toBe(false);
    expect(config.customIconUrl).toBeUndefined();
  });
});

describe('parseFolderSettingsPatch', () => {
  test('non-records yield an empty patch', () => {
    expect(parseFolderSettingsPatch(null)).toEqual({});
    expect(parseFolderSettingsPatch('nope')).toEqual({});
    expect(parseFolderSettingsPatch([1])).toEqual({});
    expect(parseFolderSettingsPatch(undefined)).toEqual({});
  });

  test('trims strings and turns a blank path into an explicit null', () => {
    expect(parseFolderSettingsPatch({ name: '  hello  ', projectPath: '  /work/x  ' })).toEqual({
      name: 'hello',
      projectPath: '/work/x',
    });
    expect(parseFolderSettingsPatch({ projectPath: '   ' })).toEqual({ projectPath: null });
  });

  test('keeps model/accent/icon verbatim and ignores non-strings', () => {
    expect(parseFolderSettingsPatch({ model: 'gpt', accentColor: '#fff', icon: 'star', name: 5 })).toEqual({
      model: 'gpt',
      accentColor: '#fff',
      icon: 'star',
    });
  });

  test('accepts customIconUrl as a string or an explicit null', () => {
    expect(parseFolderSettingsPatch({ customIconUrl: 'https://x/y.png' })).toEqual({ customIconUrl: 'https://x/y.png' });
    expect(parseFolderSettingsPatch({ customIconUrl: null })).toEqual({ customIconUrl: null });
    expect(parseFolderSettingsPatch({ customIconUrl: 3 })).toEqual({});
  });

  test('coerces boolean flags from booleans and their string forms', () => {
    expect(parseFolderSettingsPatch({ isPinned: true, isExpanded: false })).toEqual({
      isPinned: true,
      isExpanded: false,
    });
    expect(parseFolderSettingsPatch({ isPinned: 'true', isExpanded: 'false' })).toEqual({
      isPinned: true,
      isExpanded: false,
    });
  });

  test('drops flags of any other type', () => {
    expect(parseFolderSettingsPatch({ isPinned: 1, isExpanded: 'yes' })).toEqual({});
    expect(parseFolderSettingsPatch({})).toEqual({});
  });
});

describe('updateWorkspaceFolder', () => {
  test('an empty patch or an empty name performs no write', async () => {
    const db = await freshDb();
    const id = await insertFolder(db, 'keep', null);
    expect(await updateWorkspaceFolder(db, String(id), {})).toBe(false);
    expect(await updateWorkspaceFolder(db, String(id), { name: '' })).toBe(false);
    expect((await folderRow(db, id))?.name).toBe('keep');
  });

  test('writes only the supplied fields and encodes booleans as 1/0', async () => {
    const db = await freshDb();
    const id = await insertFolder(db, 'keep', '/old');
    const ok = await updateWorkspaceFolder(db, String(id), {
      name: 'renamed',
      isPinned: true,
      isExpanded: false,
      model: 'GPT-4o',
    });
    expect(ok).toBe(true);
    const row = await folderRow(db, id);
    expect(row?.name).toBe('renamed');
    expect(row?.is_pinned).toBe(1);
    expect(row?.is_expanded).toBe(0);
    expect(row?.model).toBe('GPT-4o');
    expect(row?.project_path).toBe('/old');
  });

  test('an explicit null projectPath clears the binding', async () => {
    const db = await freshDb();
    const id = await insertFolder(db, 'bound', '/work/x');
    expect(await updateWorkspaceFolder(db, String(id), { projectPath: null })).toBe(true);
    expect((await folderRow(db, id))?.project_path).toBeNull();
  });

  test('returns false when the folder id does not exist', async () => {
    const db = await freshDb();
    expect(await updateWorkspaceFolder(db, '9999', { name: 'x' })).toBe(false);
  });
});

describe('deleteWorkspaceFolder', () => {
  test('returns false for an unknown folder', async () => {
    const db = await freshDb();
    expect(await deleteWorkspaceFolder(db, '404')).toBe(false);
  });

  test('tombstones the project path and cascades sessions and files', async () => {
    const db = await freshDb();
    const id = await insertFolder(db, 'doomed', '/work/doomed');
    const other = await insertFolder(db, 'safe', '/work/safe');
    await db.run('INSERT INTO sessions (id, folder_id) VALUES (?, ?)', ['s1', id]);
    await db.run('INSERT INTO sessions (id, folder_id) VALUES (?, ?)', ['s2', other]);
    await db.run('INSERT INTO files (id, session_id) VALUES (?, ?)', ['f1', 's1']);
    await db.run('INSERT INTO files (id, session_id) VALUES (?, ?)', ['f2', 's2']);

    expect(await deleteWorkspaceFolder(db, String(id))).toBe(true);
    expect(await folderRow(db, id)).toBeNull();
    expect(await db.get('SELECT * FROM sessions WHERE id = ?', ['s1'])).toBeNull();
    expect(await db.get('SELECT * FROM files WHERE id = ?', ['f1'])).toBeNull();
    expect(await db.get('SELECT * FROM sessions WHERE id = ?', ['s2'])).toBeTruthy();
    expect(await db.get('SELECT * FROM files WHERE id = ?', ['f2'])).toBeTruthy();
    const tombstone = await db.get<{ project_path: string }>('SELECT project_path FROM deleted_workspaces');
    expect(tombstone?.project_path).toBe('/work/doomed');
  });

  test('a folder without a project path is deleted without a tombstone', async () => {
    const db = await freshDb();
    const id = await insertFolder(db, 'unbound', null);
    expect(await deleteWorkspaceFolder(db, String(id))).toBe(true);
    expect(await db.all('SELECT * FROM deleted_workspaces')).toEqual([]);
  });
});

describe('migrateLegacyProjectSettings', () => {
  async function seedLegacy(db: DbClient, value: string): Promise<void> {
    await db.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', ['omp_projects_config', value]);
  }

  async function markerValue(db: DbClient): Promise<string | undefined> {
    const row = await db.get<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', [
      'omp_projects_config_migrated',
    ]);
    return row?.value;
  }

  test('a current database (marker present) is left untouched', async () => {
    const db = await freshDb();
    const id = await insertFolder(db, 'kabmo', '/work/kabmo');
    await db.run('INSERT INTO app_settings (key, value) VALUES (?, ?)', ['omp_projects_config_migrated', '1']);
    await seedLegacy(db, JSON.stringify([{ name: 'kabmo', path: '/work/kabmo', model: 'X' }]));

    await migrateLegacyProjectSettings(db);
    expect((await folderRow(db, id))?.model).toBeNull();
  });

  test('without a legacy row it writes nothing, marker included', async () => {
    const db = await freshDb();
    await migrateLegacyProjectSettings(db);
    expect(await markerValue(db)).toBeUndefined();
  });

  test('unparseable legacy JSON aborts without marking', async () => {
    const db = await freshDb();
    await seedLegacy(db, '{not json');
    await migrateLegacyProjectSettings(db);
    expect(await markerValue(db)).toBeUndefined();
  });

  test('matches by project path and fills defaults for missing fields', async () => {
    const db = await freshDb();
    const id = await insertFolder(db, 'kabmo', '/work/kabmo');
    await seedLegacy(db, JSON.stringify([{ path: '/work/kabmo' }]));

    await migrateLegacyProjectSettings(db);
    const row = await folderRow(db, id);
    expect(row?.model).toBe('Not selected');
    expect(row?.accent_color).toBe('');
    expect(row?.icon).toBe('default');
    expect(row?.custom_icon_url).toBeNull();
    expect(await markerValue(db)).toBe('1');
  });

  test('carries the legacy fields through when present', async () => {
    const db = await freshDb();
    const id = await insertFolder(db, 'anything', '/work/x');
    await seedLegacy(
      db,
      JSON.stringify([{ path: '/work/x', model: 'GPT-4o', accentColor: '#abc', icon: 'star', customIconUrl: 'https://i' }]),
    );

    await migrateLegacyProjectSettings(db);
    const row = await folderRow(db, id);
    expect(row?.model).toBe('GPT-4o');
    expect(row?.accent_color).toBe('#abc');
    expect(row?.icon).toBe('star');
    expect(row?.custom_icon_url).toBe('https://i');
  });

  test('falls back to a case-insensitive name match', async () => {
    const db = await freshDb();
    const id = await insertFolder(db, 'Kabmo', null);
    await seedLegacy(db, JSON.stringify([{ name: 'kabmo', model: 'DeepSeek-R1' }]));

    await migrateLegacyProjectSettings(db);
    expect((await folderRow(db, id))?.model).toBe('DeepSeek-R1');
  });

  test('skips legacy entries that match no folder and still marks done', async () => {
    const db = await freshDb();
    const id = await insertFolder(db, 'unrelated', '/work/other');
    await seedLegacy(db, JSON.stringify([{ path: '/work/nowhere' }, null, 'garbage']));

    await migrateLegacyProjectSettings(db);
    expect((await folderRow(db, id))?.model).toBeNull();
    expect(await markerValue(db)).toBe('1');
  });

  test('a non-array legacy document falls back to the default project list', async () => {
    const db = await freshDb();
    const id = await insertFolder(db, 'kabmo', '/Users/rajebdev/JatisMobile/kabmo');
    await seedLegacy(db, JSON.stringify({ projects: [] }));

    await migrateLegacyProjectSettings(db);
    const row = await folderRow(db, id);
    expect(row?.model).toBe('Not selected');
    expect(row?.accent_color).toBe('#38bdf8');
    expect(row?.icon).toBe('default');
    expect(await markerValue(db)).toBe('1');
  });
});
