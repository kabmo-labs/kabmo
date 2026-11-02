/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The project default model reaching a new chat.
 *
 * "Defaults for new chats" is only a setting if the spawn reads it: the column
 * rendered in two panes while `POST /api/agent/new` fell back to Kabmo's global
 * pick, so every chat started on the global model regardless. These cases pin
 * the resolution — exact root, a worktree/nested cwd under the root, a folder
 * with no model (inherit), and a legacy display name that cannot name a model.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { createDb, type DbClient } from '@/server/lib/db/client';
import { projectModelForCwd } from '@/server/lib/workspace/project-model.server';
import { removeDir } from '@/test-support/remove-dir';

const ROOT = `${os.tmpdir()}/kabmo-project-model-${process.pid}`;

let workRoot = '';
let db: DbClient;

beforeAll(async () => {
  workRoot = mkdtempSync(path.join(os.tmpdir(), 'kabmo-project-model-'));
  db = createDb(path.join(workRoot, 'db.sqlite'));
  await db.exec(`
    CREATE TABLE workspace_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      project_path TEXT,
      model TEXT
    );
  `);
  await db.run('INSERT INTO workspace_folders (name, project_path, model) VALUES (?, ?, ?)', [
    'kenari-project',
    ROOT,
    'kenari:deepseek-v4-flash',
  ]);
  await db.run('INSERT INTO workspace_folders (name, project_path, model) VALUES (?, ?, ?)', [
    'legacy',
    `${ROOT}-legacy`,
    'GPT-4o',
  ]);
  await db.run('INSERT INTO workspace_folders (name, project_path, model) VALUES (?, ?, ?)', [
    'unset',
    `${ROOT}-unset`,
    'Not selected',
  ]);
  await db.run('INSERT INTO workspace_folders (name, project_path, model) VALUES (?, ?, ?)', [
    'nested',
    `${ROOT}/nested`,
    'openai:gpt-5',
  ]);
});

afterAll(() => {
  db.raw.close();
  removeDir(workRoot);
});

describe('projectModelForCwd', () => {
  test('resolves the bound root to the composite model the picker stored', async () => {
    expect(await projectModelForCwd(db, ROOT)).toEqual({
      provider: 'kenari',
      modelId: 'deepseek-v4-flash',
    });
  });

  test('a cwd nested under the root (a worktree) resolves to the same project', async () => {
    expect(await projectModelForCwd(db, `${ROOT}/.worktrees/feature-x`)).toEqual({
      provider: 'kenari',
      modelId: 'deepseek-v4-flash',
    });
  });

  test('the schema default and a legacy display name both yield no override', async () => {
    expect(await projectModelForCwd(db, `${ROOT}-unset`)).toBeNull();
    // A display name cannot name a model: falling back to Kabmo's pick is
    // honest, and inventing a provider would start the chat on the wrong model.
    expect(await projectModelForCwd(db, `${ROOT}-legacy`)).toBeNull();
  });

  test('a nested workspace wins over the root that contains it', async () => {
    expect(await projectModelForCwd(db, `${ROOT}/nested/crate`)).toEqual({
      provider: 'openai',
      modelId: 'gpt-5',
    });
  });

  test('an unregistered cwd and an empty one yield no override', async () => {
    expect(await projectModelForCwd(db, '/nowhere/at/all')).toBeNull();
    expect(await projectModelForCwd(db, '')).toBeNull();
    expect(await projectModelForCwd(db, null)).toBeNull();
  });
});
