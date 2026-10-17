/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `POST /api/folders/clone` — the New Workspace modal's Clone button.
 *
 * The orderings here are the ones a happy path cannot show, and each is a
 * failure a user would have to clean up by hand:
 *
 * - a name collision is refused BEFORE the clone, so a rejected request costs
 *   no download and leaves no directory;
 * - a failed clone removes the partial tree `git clone` creates before it knows
 *   the fetch will fail;
 * - the workspace row is written from the RESOLVED destination, so the folder
 *   the sidebar lists and the directory on disk are the same path.
 *
 * The source repository is a real one built in a temp directory (a `file://`
 * URL, which `isGitUrl` accepts), because the route shells out to the real
 * `git` — a stub would test the stub, not the argv this route builds.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getDb } from '@/server/db.server';
import { action as cloneAction } from '@/server/routes/folders/clone';

// `tmpdir()` rather than a literal `/tmp`: on Windows there is no `/tmp`, so a
// POSIX-literal root makes every write land at a path the OS resolves against
// the current drive — the fixture directories never exist where the route looks
// for them, and the request fails for a reason unrelated to what is under test.
const ROOT = path.join(os.tmpdir(), 'omc-folders-clone-test');
const PROJECTS = path.join(ROOT, 'projects');
const ORIGIN = path.join(ROOT, 'origin');

function post(body: unknown): Request {
  return new Request('http://localhost/api/folders/clone', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function clone(body: unknown) {
  const res = (await cloneAction({ request: post(body), params: {} } as never)) as Response;
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function git(args: string[], cwd: string): void {
  const proc = Bun.spawnSync({ cmd: ['git', ...args], cwd, stdout: 'pipe', stderr: 'pipe' });
  if (proc.exitCode !== 0) throw new Error(proc.stderr.toString());
}

beforeAll(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(PROJECTS, { recursive: true });
  fs.mkdirSync(ORIGIN, { recursive: true });
  git(['init', '-q', '-b', 'main'], ORIGIN);
  git(['config', 'user.email', 'test@example.invalid'], ORIGIN);
  git(['config', 'user.name', 'Test'], ORIGIN);
  fs.writeFileSync(path.join(ORIGIN, 'README.md'), '# origin\n');
  git(['add', '-A'], ORIGIN);
  git(['commit', '-q', '-m', 'seed'], ORIGIN);

  Bun.env.PI_CODING_AGENT_DIR = path.join(ROOT, 'agent');
  Bun.env.OMPCHAMBER_DB_PATH = path.join(ROOT, 'db.sqlite');
  Bun.env.SYNC_WORKSPACE = 'false';
  delete Bun.env.MOCK;
  globalThis.__ompChamberDb = undefined;
});

afterEach(async () => {
  delete Bun.env.MOCK;
  for (const entry of fs.readdirSync(PROJECTS)) {
    fs.rmSync(path.join(PROJECTS, entry), { recursive: true, force: true });
  }
  const db = await getDb();
  await db.run('DELETE FROM workspace_folders');
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

describe('POST /api/folders/clone', () => {
  test('clones into <parent>/<slug> and registers the workspace at that same path', async () => {
    const { status, body } = await clone({ url: ORIGIN, parent: PROJECTS });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    const target = path.join(PROJECTS, 'origin');
    expect(body.path).toBe(target);
    expect(fs.existsSync(path.join(target, 'README.md'))).toBe(true);

    const db = await getDb();
    const row = await db.get<{ name: string; project_path: string }>(
      'SELECT name, project_path FROM workspace_folders WHERE project_path = ?',
      [target],
    );
    expect(row?.name).toBe('origin');
    expect(row?.project_path).toBe(target);
  });

  test('refuses an invalid URL without touching the filesystem', async () => {
    const { status, body } = await clone({ url: 'not a url', parent: PROJECTS });

    expect(status).toBe(400);
    expect(body.code).toBe('invalid_url');
    expect(fs.readdirSync(PROJECTS)).toEqual([]);
  });

  test('refuses a destination that already exists', async () => {
    fs.mkdirSync(path.join(PROJECTS, 'origin'));
    const { status, body } = await clone({ url: ORIGIN, parent: PROJECTS });

    expect(status).toBe(409);
    expect(body.code).toBe('exists');
  });

  test('refuses a duplicate workspace name BEFORE cloning, so nothing is downloaded', async () => {
    const db = await getDb();
    await db.run('INSERT INTO workspace_folders (name, is_expanded) VALUES (?, 1)', ['origin']);

    const { status, body } = await clone({ url: ORIGIN, parent: PROJECTS });

    expect(status).toBe(400);
    expect(body.code).toBe('duplicate_name');
    // The whole point: no directory was created by a request that could never
    // have succeeded.
    expect(fs.readdirSync(PROJECTS)).toEqual([]);
  });

  test('removes the partial directory a failed clone leaves behind', async () => {
    const missing = path.join(ROOT, 'no-such-repo');
    const { status, body } = await clone({ url: missing, parent: PROJECTS });

    expect(status).toBe(400);
    expect(body.code).toBe('clone_failed');
    expect(fs.existsSync(path.join(PROJECTS, 'no-such-repo'))).toBe(false);

    const db = await getDb();
    expect(await db.all('SELECT id FROM workspace_folders')).toEqual([]);
  });

  test('refuses under MOCK', async () => {
    Bun.env.MOCK = 'true';
    const { status } = await clone({ url: ORIGIN, parent: PROJECTS });

    expect(status).toBe(400);
    expect(fs.readdirSync(PROJECTS)).toEqual([]);
  });
});
