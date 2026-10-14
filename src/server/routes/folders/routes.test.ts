/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The two creation paths the New Workspace modal drives.
 *
 * `/api/folders` already had a workspace, so its cases here pin the behaviour
 * the SHARED insert moved into `register-folder.server.ts` — the tombstone
 * clear and the case-insensitive name guard — because a refactor that quietly
 * dropped either would only show up as a workspace that reappears (or refuses
 * to) on a later boot.
 *
 * `/api/folders/mkdir` is new and its refusals are the interesting half: a name
 * carrying a separator must not reach the filesystem, an existing name must be
 * reported rather than adopted, and a missing parent must be named as such
 * instead of being created. The parent is a real temp directory, because the
 * route validates an absolute path rather than a `resolveRoot` scope — the
 * whole reason it is not `/api/fs/action`'s `create`.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { getDb } from '@/server/db.server';
import { action as createAction } from '@/server/routes/folders/create';
import { action as mkdirAction } from '@/server/routes/folders/mkdir';

const ROOT = '/tmp/omc-folders-routes-test';
const WORKSPACE = path.join(ROOT, 'projects');

function post(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function call(handler: typeof createAction, url: string, body: unknown) {
  const res = (await handler({ request: post(url, body), params: {} } as never)) as Response;
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** The folder name a creation response carries, narrowed rather than cast. */
function folderName(body: Record<string, unknown>): string {
  const folder = body.folder;
  if (folder && typeof folder === 'object' && 'name' in folder && typeof folder.name === 'string') {
    return folder.name;
  }
  throw new Error(`response carried no folder name: ${JSON.stringify(body)}`);
}

beforeAll(async () => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(WORKSPACE, { recursive: true });
  Bun.env.PI_CODING_AGENT_DIR = path.join(ROOT, 'agent');
  Bun.env.OMPCHAMBER_DB_PATH = path.join(ROOT, 'db.sqlite');
  Bun.env.SYNC_WORKSPACE = 'false';
  delete Bun.env.MOCK;
  globalThis.__ompChamberDb = undefined;
  await getDb();
});

afterEach(async () => {
  delete Bun.env.MOCK;
  // The mkdir cases write real directories, so the tree is reset with the rows
  // — otherwise a later case asserts against a listing an earlier one filled.
  for (const entry of fs.readdirSync(WORKSPACE)) {
    fs.rmSync(path.join(WORKSPACE, entry), { recursive: true, force: true });
  }
  const db = await getDb();
  await db.run('DELETE FROM workspace_folders');
  await db.run('DELETE FROM deleted_workspaces');
});

afterAll(() => {
  globalThis.__ompChamberDb?.resolved?.raw.close();
  globalThis.__ompChamberDb = undefined;
  delete Bun.env.PI_CODING_AGENT_DIR;
  delete Bun.env.OMPCHAMBER_DB_PATH;
  delete Bun.env.SYNC_WORKSPACE;
  delete Bun.env.MOCK;
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe('POST /api/folders/mkdir', () => {
  test('creates one subdirectory of the named parent and reports its path', async () => {
    const { status, body } = await call(mkdirAction, 'http://localhost/api/folders/mkdir', {
      parent: WORKSPACE,
      name: 'fresh-folder',
    });

    expect(status).toBe(200);
    expect(body).toEqual({ success: true, path: path.join(WORKSPACE, 'fresh-folder'), name: 'fresh-folder' });
    expect(fs.statSync(path.join(WORKSPACE, 'fresh-folder')).isDirectory()).toBe(true);
  });

  test('refuses a name carrying a separator, so the parent is the only location', async () => {
    for (const name of ['../escape', 'sub/escape', 'sub\\escape', '..', '.']) {
      const { status } = await call(mkdirAction, 'http://localhost/api/folders/mkdir', {
        parent: WORKSPACE,
        name,
      });
      expect(status).toBe(400);
    }
    expect(fs.readdirSync(WORKSPACE)).toEqual([]);
  });

  test('reports an existing name rather than adopting it', async () => {
    fs.mkdirSync(path.join(WORKSPACE, 'taken'));
    const { status, body } = await call(mkdirAction, 'http://localhost/api/folders/mkdir', {
      parent: WORKSPACE,
      name: 'taken',
    });

    expect(status).toBe(409);
    expect(body.error).toBe('taken already exists');
  });

  test('names a missing parent as such instead of creating the tree', async () => {
    const missing = path.join(WORKSPACE, 'not-there');
    const { status, body } = await call(mkdirAction, 'http://localhost/api/folders/mkdir', {
      parent: missing,
      name: 'child',
    });

    expect(status).toBe(400);
    expect(body.code).toBe('parent_not_a_directory');
    expect(fs.existsSync(missing)).toBe(false);
  });

  test('refuses under MOCK, where there is no filesystem to write to', async () => {
    Bun.env.MOCK = 'true';
    const { status } = await call(mkdirAction, 'http://localhost/api/folders/mkdir', {
      parent: WORKSPACE,
      name: 'mock-folder',
    });

    expect(status).toBe(400);
    expect(fs.existsSync(path.join(WORKSPACE, 'mock-folder'))).toBe(false);
  });
});

describe('POST /api/folders', () => {
  test('clears a tombstone for the same project path so the folder survives the next boot', async () => {
    const db = await getDb();
    await db.run('INSERT INTO deleted_workspaces (project_path) VALUES (?)', [WORKSPACE]);

    const { status, body } = await call(createAction, 'http://localhost/api/folders', {
      name: 'Projects',
      path: WORKSPACE,
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    const tombstones = await db.all('SELECT project_path FROM deleted_workspaces');
    expect(tombstones).toEqual([]);
  });

  test('refuses a second folder with the same name, case-insensitively', async () => {
    await call(createAction, 'http://localhost/api/folders', { name: 'Projects', path: WORKSPACE });
    const { status, body } = await call(createAction, 'http://localhost/api/folders', {
      name: 'projects',
      path: WORKSPACE,
    });

    expect(status).toBe(400);
    expect(body.code).toBe('duplicate_name');
  });

  test('derives the name from the directory when none was given', async () => {
    const { status, body } = await call(createAction, 'http://localhost/api/folders', { path: WORKSPACE });

    expect(status).toBe(200);
    expect(folderName(body)).toBe('projects');
  });
});
