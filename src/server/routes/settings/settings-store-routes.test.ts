/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The settings routes backed by Kabmo SQLite store: root, projects and
 * behavior.
 *
 * Each of these modules owns a request contract that is easy to break from the
 * client side and invisible from the server side, so every case here pins a
 * value a caller depends on:
 *
 * - `root` merges plain-object patches key-by-key but replaces arrays and
 *   scalars, because the settings modal and the theme picker write the same
 *   blob independently and a whole-object write would discard the other's keys.
 * - `projects` refuses a write with no `folderId` and a delete of an unknown
 *   folder with distinct codes, so a malformed request is not reported as a
 *   missing workspace.
 * - `behavior` refuses an unknown `file` and a non-string `rules`, and its
 *   reset restores the shipped AGENTS.md preset but clears RULES.md.
 *
 * The DB is a fresh temp file (`KABMO_DB_PATH`, `SYNC_WORKSPACE=false`) and the
 * agent dir a temp tree, so no case can reach the developer's real `~/.omp` or
 * `~/.kabmo`. The agents route writes FILES, so its cases live beside it in
 * `agents.test.ts`. Tests run in real mode unless a case opts into
 * MOCK for a mock-only branch; the db slot is primed in `beforeAll` so a later
 * MOCK toggle cannot re-resolve the path to the repo's own `workspace.db`.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getDb } from '@/server/db.server';
import { DEFAULT_BEHAVIOR_RULES } from '@/client/data/settings/behavior';
import { action as behaviorAction, loader as behaviorLoader } from '@/server/routes/settings/behavior';
import { action as projectsAction, loader as projectsLoader } from '@/server/routes/settings/projects';
import { action as rootAction, loader as rootLoader } from '@/server/routes/settings/root';
import { removeDir } from '@/test-support/remove-dir';

// `tmpdir()` rather than a literal `/tmp`: on Windows there is no `/tmp`, so a
// POSIX-literal root makes every write land at a path the OS resolves against
// the current drive — the fixture directories never exist where the route looks
// for them, and the request fails for a reason unrelated to what is under test.
const ROOT = path.join(os.tmpdir(), 'omc-settings-store-routes-test');
const API = 'http://localhost/api/settings';

beforeAll(async () => {
  removeDir(ROOT);
  fs.mkdirSync(path.join(ROOT, 'agent'), { recursive: true });
  Bun.env.PI_CODING_AGENT_DIR = path.join(ROOT, 'agent');
  Bun.env.KABMO_DB_PATH = path.join(ROOT, 'db.sqlite');
  Bun.env.SYNC_WORKSPACE = 'false';
  delete Bun.env.MOCK;
  globalThis.__kabmoDb = undefined;
  await getDb();
});

afterEach(() => {
  delete Bun.env.MOCK;
});

afterAll(() => {
  globalThis.__kabmoDb?.resolved?.raw.close();
  globalThis.__kabmoDb = undefined;
  delete Bun.env.PI_CODING_AGENT_DIR;
  delete Bun.env.KABMO_DB_PATH;
  delete Bun.env.SYNC_WORKSPACE;
  delete Bun.env.MOCK;
  removeDir(ROOT);
});

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

describe('settings root', () => {
  test('a plain-object patch merges into the stored key', async () => {
    expect((await call(rootAction, send(API, 'POST', { omp_demo: { a: 1 } }))).status).toBe(200);
    expect((await call(rootAction, send(API, 'POST', { omp_demo: { b: 2 } }))).status).toBe(200);
    const body = await (await call(rootLoader, new Request(API))).json();
    expect(body.settings.omp_demo).toEqual({ a: 1, b: 2 });
  });

  test('a scalar is stored raw and an array replaces outright', async () => {
    await call(rootAction, send(API, 'POST', { note: 'hello', list: [1, 2] }));
    const body = await (await call(rootLoader, new Request(API))).json();
    expect(body.settings.note).toBe('hello');
    expect(body.settings.list).toEqual([1, 2]);
    await call(rootAction, send(API, 'POST', { list: [3] }));
    expect((await (await call(rootLoader, new Request(API))).json()).settings.list).toEqual([3]);
  });

  test('a malformed JSON body is a 500, not a silent success', async () => {
    const res = await call(rootAction, new Request(API, { method: 'POST', body: '{not-json' }));
    expect(res.status).toBe(500);
    expect(typeof (await res.json()).error).toBe('string');
  });

  test('a wrong verb is the route-owned 405', async () => {
    const res = await call(rootAction, send(API, 'PUT', { a: 1 }));
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error: 'Method not allowed' });
  });
});

describe('settings projects', () => {
  test('the loader reports the accent options alongside the list', async () => {
    const body = await (await call(projectsLoader, new Request(`${API}/projects`))).json();
    expect(Array.isArray(body.projects)).toBe(true);
    expect(Array.isArray(body.accentColorOptions)).toBe(true);
    expect(body.accentColorOptions[0]).toMatchObject({ label: 'None', value: '' });
    // The default model comes from the live catalog, not from this route: a
    // hardcoded list of display names here was never readable by a spawn.
    expect(body.availableModels).toBeUndefined();
  });

  test('a delete without an id is refused before touching the store', async () => {
    const res = await call(projectsAction, new Request(`${API}/projects`, { method: 'DELETE' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'id is required' });
  });

  test('a delete of an unknown folder is a 404', async () => {
    const res = await call(projectsAction, new Request(`${API}/projects?id=folder-9999`, { method: 'DELETE' }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Workspace not found' });
  });

  test('a non-JSON body and a body without project are distinct 400s', async () => {
    const badJson = await call(projectsAction, new Request(`${API}/projects`, { method: 'POST', body: '{' }));
    expect(badJson.status).toBe(400);
    expect(await badJson.json()).toEqual({ error: 'Invalid JSON body' });

    const noProject = await call(projectsAction, send(`${API}/projects`, 'POST', {}));
    expect(noProject.status).toBe(400);
    expect(await noProject.json()).toEqual({ error: 'project is required' });

    const noId = await call(projectsAction, send(`${API}/projects`, 'POST', { project: {} }));
    expect(noId.status).toBe(400);
    expect(await noId.json()).toEqual({ error: 'project.folderId is required' });
  });

  test('an unknown folderId is a 404 and a known one updates in place', async () => {
    const missing = await call(projectsAction, send(`${API}/projects`, 'POST', { project: { folderId: 4242, name: 'x' } }));
    expect(missing.status).toBe(404);

    const db = await getDb();
    await db.run('INSERT INTO workspace_folders (id, name, is_expanded) VALUES (?, ?, ?)', [1, 'Old', 1]);
    const res = await call(projectsAction, send(`${API}/projects`, 'POST', { project: { folderId: 1, name: 'Renamed' } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.project).toMatchObject({ id: 'folder-1', folderId: 1, name: 'Renamed' });

    const del = await call(projectsAction, new Request(`${API}/projects?id=folder-1`, { method: 'DELETE' }));
    expect(await del.json()).toEqual({ success: true });
  });

  test('a wrong verb is the route-owned 405', async () => {
    const res = await call(projectsAction, send(`${API}/projects`, 'OPTIONS'));
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error: 'Method not allowed' });
  });
});

describe('settings behavior', () => {
  test('the loader rejects an unknown file name', async () => {
    const res = await call(behaviorLoader, new Request(`${API}/behavior?file=bogus`));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'file must be "agents" or "rules"' });
  });

  test('an absent file defaults to agents, and RULES.md starts empty', async () => {
    const agents = await (await call(behaviorLoader, new Request(`${API}/behavior`))).json();
    expect(agents.kind).toBe('agents');
    const rules = await (await call(behaviorLoader, new Request(`${API}/behavior?file=rules`))).json();
    expect(rules).toMatchObject({ kind: 'rules', rules: '', exists: false, isMock: false });
  });

  test('a write with no rules string is refused, not coerced to empty', async () => {
    const res = await call(behaviorAction, send(`${API}/behavior`, 'POST', {}));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'rules must be a string' });

    const numeric = await call(behaviorAction, send(`${API}/behavior`, 'POST', { file: 'rules', rules: 123 }));
    expect(numeric.status).toBe(400);

    const unknown = await call(behaviorAction, send(`${API}/behavior`, 'POST', { file: 'bogus', rules: 'x' }));
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: 'file must be "agents" or "rules"' });
  });

  test('rules are written to the temp agent dir and can be reset', async () => {
    const saved = await call(behaviorAction, send(`${API}/behavior`, 'POST', { file: 'rules', rules: 'Be nice.' }));
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ success: true, rules: 'Be nice.', exists: true, isMock: false });

    const read = await (await call(behaviorLoader, new Request(`${API}/behavior?file=rules`))).json();
    expect(read).toMatchObject({ rules: 'Be nice.', exists: true });

    const reset = await call(behaviorAction, send(`${API}/behavior`, 'POST', { file: 'rules', action: 'reset' }));
    expect(await reset.json()).toMatchObject({ success: true, rules: '', exists: false });
  });

  test('MOCK writes to the store and reset restores the shipped agents preset', async () => {
    Bun.env.MOCK = 'true';
    const saved = await call(behaviorAction, send(`${API}/behavior`, 'POST', { file: 'agents', rules: 'Mock rule.' }));
    expect(await saved.json()).toMatchObject({ success: true, rules: 'Mock rule.', isMock: true });

    const reset = await call(behaviorAction, send(`${API}/behavior`, 'POST', { file: 'agents', action: 'reset' }));
    expect((await reset.json()).rules).toBe(DEFAULT_BEHAVIOR_RULES);
  });

  test('a wrong verb is the route-owned 405', async () => {
    const res = await call(behaviorAction, new Request(`${API}/behavior`, { method: 'DELETE' }));
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error: 'Method not allowed' });
  });
});
