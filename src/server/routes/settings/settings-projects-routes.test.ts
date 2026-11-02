/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `POST /api/settings/projects` — the refusal half of the project form.
 *
 * The pane edits facts that decide where a chat runs and which sessions the
 * sidebar lists, so every rule that can make a write unhonourable is enforced
 * here and named in the response:
 *
 * - an empty name (the store skips it, so the form would show a value the row
 *   never took),
 * - a name another workspace already holds (case-insensitively — the sidebar
 *   identifies a workspace by name),
 * - a path that is not an existing directory (a typo bound a folder that then
 *   listed nothing, with no reason on screen),
 * - a directory another workspace is already bound to (two rows would list the
 *   same sessions and fight over the discovery tombstones).
 *
 * A refusal must also leave the stored row UNCHANGED — half-applied writes are
 * what made a rename look successful until the next refresh.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { getDb } from '@/server/db.server';
import { action as projectsAction, loader as projectsLoader } from '@/server/routes/settings/projects';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { removeDir } from '@/test-support/remove-dir';

const ROOT = path.join(os.tmpdir(), 'omc-settings-projects-routes-test');
const API = 'http://localhost/api/settings/projects';
const AGENT_DIR = path.join(ROOT, 'agent');

type Handler = (args: never) => unknown;

function call(handler: Handler, request: Request): Promise<Response> {
  return handler({ request, params: {} } as never) as Promise<Response>;
}

function send(url: string, verb: string, body?: unknown): Request {
  return new Request(url, {
    method: verb,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  });
}

async function folderId(name: string): Promise<number> {
  const db = await getDb();
  const row = await db.get<{ id: number }>('SELECT id FROM workspace_folders WHERE name = ?', [name]);
  if (!row) throw new Error(`no folder named ${name}`);
  return row.id;
}

beforeAll(async () => {
  removeDir(ROOT);
  fs.mkdirSync(AGENT_DIR, { recursive: true });
  Bun.env.PI_CODING_AGENT_DIR = AGENT_DIR;
  Bun.env.SYNC_WORKSPACE = 'false';
  delete Bun.env.MOCK;
  await isolateDb();
  await getDb();
});

beforeEach(async () => {
  const db = await getDb();
  await db.run('DELETE FROM workspace_folders');
});

afterAll(async () => {
  await releaseDb();
  delete Bun.env.PI_CODING_AGENT_DIR;
  delete Bun.env.SYNC_WORKSPACE;
  removeDir(ROOT);
});

describe('settings projects route', () => {
  test('the loader serves the accent palette but no model list', async () => {
    const body = await (await call(projectsLoader, new Request(API))).json();
    expect(Array.isArray(body.projects)).toBe(true);
    expect(body.accentColorOptions[0]).toMatchObject({ label: 'None', value: '' });
    // The default model is a `provider:modelId` from the live catalog, so this
    // route must not answer with a hardcoded list of display names.
    expect(body.availableModels).toBeUndefined();
  });

  test('an empty name is refused and the stored name survives', async () => {
    const db = await getDb();
    await db.run('INSERT INTO workspace_folders (name, is_expanded) VALUES (?, 1)', ['Keep']);
    const id = await folderId('Keep');

    const res = await call(projectsAction, send(API, 'POST', { project: { folderId: id, name: '   ' } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'name_required' });
    expect((await db.get<{ name: string }>('SELECT name FROM workspace_folders WHERE id = ?', [id]))?.name).toBe('Keep');
  });

  test('a duplicate name is a 409 naming the clash, and nothing is written', async () => {
    const db = await getDb();
    await db.run('INSERT INTO workspace_folders (name, is_expanded) VALUES (?, 1)', ['alpha']);
    await db.run('INSERT INTO workspace_folders (name, is_expanded) VALUES (?, 1)', ['beta']);
    const id = await folderId('beta');

    const res = await call(projectsAction, send(API, 'POST', { project: { folderId: id, name: 'ALPHA' } }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'duplicate_name' });
    expect((await db.get<{ name: string }>('SELECT name FROM workspace_folders WHERE id = ?', [id]))?.name).toBe('beta');
  });

  test('a path that is not a directory is refused and the old binding survives', async () => {
    const db = await getDb();
    await db.run('INSERT INTO workspace_folders (name, is_expanded, project_path) VALUES (?, 1, ?)', ['bound', AGENT_DIR]);
    const id = await folderId('bound');

    const res = await call(
      projectsAction,
      send(API, 'POST', { project: { folderId: id, projectPath: path.join(ROOT, 'nope') } }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'directory_not_found' });
    expect((await db.get<{ project_path: string }>('SELECT project_path FROM workspace_folders WHERE id = ?', [id]))?.project_path)
      .toBe(AGENT_DIR);
  });

  test('a directory another workspace already holds is a 409 naming the holder', async () => {
    await getDb().then((db) => db.run(
      'INSERT INTO workspace_folders (name, is_expanded, project_path) VALUES (?, 1, ?)',
      ['first', AGENT_DIR],
    ));
    await getDb().then((db) => db.run('INSERT INTO workspace_folders (name, is_expanded) VALUES (?, 1)', ['second']));
    const id = await folderId('second');

    const res = await call(projectsAction, send(API, 'POST', { project: { folderId: id, projectPath: AGENT_DIR } }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'duplicate_path' });
  });

  test('an accepted bind is stored as the absolute path, and changing the path re-syncs discovery', async () => {
    const db = await getDb();
    await db.run('INSERT INTO workspace_folders (name, is_expanded) VALUES (?, 1)', ['tilde']);
    const id = await folderId('tilde');

    const res = await call(projectsAction, send(API, 'POST', { project: { folderId: id, projectPath: AGENT_DIR } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, changed: true });
    expect(body.project).toMatchObject({ name: 'tilde', path: AGENT_DIR });
    expect(path.isAbsolute(body.project.path)).toBe(true);
  });

  test('a custom accent is stored in one canonical form', async () => {
    const db = await getDb();
    await db.run('INSERT INTO workspace_folders (name, is_expanded) VALUES (?, 1)', ['custom']);
    const id = await folderId('custom');

    // `#ABC` and `#aabbcc` are the same colour; the sidebar compares the stored
    // string against the preset table, so one spelling has to win.
    const res = await call(projectsAction, send(API, 'POST', { project: { folderId: id, accentColor: '#0F8' } }));
    expect(res.status).toBe(200);
    expect((await res.json()).project).toMatchObject({ accentColor: '#00ff88' });
    expect(
      (await db.get<{ accent_color: string }>('SELECT accent_color FROM workspace_folders WHERE id = ?', [id]))?.accent_color,
    ).toBe('#00ff88');

    // The paint the sidebar actually does: a six-digit hex reaches the loader.
    const body = await (await call(projectsLoader, new Request(API))).json();
    expect(body.projects.find((project: { folderId: number }) => project.folderId === id)).toMatchObject({
      accentColor: '#00ff88',
    });
  });

  test('an accent that is not a hex colour is refused before it reaches a style', async () => {
    const db = await getDb();
    await db.run('INSERT INTO workspace_folders (name, is_expanded, accent_color) VALUES (?, 1, ?)', ['plain', '#38bdf8']);
    const id = await folderId('plain');

    for (const accentColor of ['red;background:url(//evil)', 'rgb(1,2,3)', '#12345', 'url(#x)']) {
      const res = await call(projectsAction, send(API, 'POST', { project: { folderId: id, accentColor } }));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'invalid_accent' });
    }
    expect(
      (await db.get<{ accent_color: string }>('SELECT accent_color FROM workspace_folders WHERE id = ?', [id]))?.accent_color,
    ).toBe('#38bdf8');
  });

  test('an empty accent clears the mark instead of being refused', async () => {
    const db = await getDb();
    await db.run('INSERT INTO workspace_folders (name, is_expanded, accent_color) VALUES (?, 1, ?)', ['clearing', '#f43f5e']);
    const id = await folderId('clearing');

    const res = await call(projectsAction, send(API, 'POST', { project: { folderId: id, accentColor: '' } }));
    expect(res.status).toBe(200);
    expect((await res.json()).project).toMatchObject({ accentColor: '' });
  });

  test('a body carrying no editable field answers success with changed:false', async () => {
    const db = await getDb();
    await db.run('INSERT INTO workspace_folders (name, is_expanded) VALUES (?, 1)', ['same']);
    const id = await folderId('same');

    // Only the id: nothing the store can write. That is an ANSWER, not a
    // failure — the form may legitimately re-send an untouched row.
    const res = await call(projectsAction, send(API, 'POST', { project: { folderId: id } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, changed: false });
    expect((await db.get<{ name: string }>('SELECT name FROM workspace_folders WHERE id = ?', [id]))?.name).toBe('same');
  });
});
