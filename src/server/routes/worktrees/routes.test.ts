/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The `/api/worktrees` routes, end to end over a real repository.
 *
 * What a unit test on the modules cannot show, and what these cases are for:
 *
 *  - the LIST payload carries every fact a row draws, from one read;
 *  - a create answers with the worktree it made, and the next list shows it —
 *    the topology cache invalidation is what makes "next list" true;
 *  - a DELETE takes the path in its BODY (a path has separators) and answers the
 *    branch verdict rather than a bare success;
 *  - MOCK refuses, because a demo install has no repository to make one in.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb } from '@/server/db.server';
import { loader as listLoader } from '@/server/routes/worktrees/list';
import { action as createAction, validateAction } from '@/server/routes/worktrees/create';
import { action as removeAction } from '@/server/routes/worktrees/remove';
import { invalidateWorktreeTopology } from '@/server/lib/fs/worktree/topology';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { removeDir } from '@/test-support/remove-dir';

const GIT_ENV = {
  ...Bun.env,
  GIT_EDITOR: 'true',
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
};

function git(cwd: string, ...args: string[]): string {
  return Bun.spawnSync({ cmd: ['git', ...args], cwd, env: GIT_ENV }).stdout.toString();
}

let workRoot: string;
let repo: string;
const saved = { MOCK: Bun.env.MOCK, SYNC_WORKSPACE: Bun.env.SYNC_WORKSPACE };

/**
 * Call a route module the way the adapter does — with `params`, which every
 * Remix-shaped handler declares even when its path has no parameter.
 */
async function call(
  handler: (args: { request: Request; params: Record<string, string> }) => unknown,
  url: string,
  init?: RequestInit,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = (await handler({ request: new Request(url, init), params: {} })) as Response;
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** The `worktrees` array of a list payload, narrowed once. */
function worktreesOf(body: Record<string, unknown>): Array<Record<string, unknown>> {
  const list = body.worktrees;
  return Array.isArray(list) ? (list as Array<Record<string, unknown>>) : [];
}

const base = (): string => `http://localhost/api/worktrees?root=${encodeURIComponent(repo)}`;

beforeAll(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'kabmo-worktree-routes-'));
  repo = join(workRoot, 'repo');
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, '.gitignore'), 'node_modules\n');
  mkdirSync(join(repo, 'node_modules', 'dep'), { recursive: true });
  writeFileSync(join(repo, 'node_modules', 'dep', 'index.js'), 'module.exports = {};\n');
  writeFileSync(join(repo, 'readme.md'), 'hello\n');
  git(repo, 'init', '-q', '-b', 'main', '.');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
});

beforeEach(async () => {
  await isolateDb();
  Bun.env.MOCK = 'false';
  Bun.env.SYNC_WORKSPACE = 'false';
  const db = await getDb();
  await db.run('INSERT INTO workspace_folders (name, project_path) VALUES (?, ?)', ['proj', repo]);
});

afterEach(async () => {
  invalidateWorktreeTopology();
  await releaseDb();
});

afterAll(() => {
  removeDir(workRoot);
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete Bun.env[key];
    else Bun.env[key] = value;
  }
});

describe('GET /api/worktrees', () => {
  test('lists the checkout with the facts a row draws', async () => {
    const { status, body } = await call(listLoader, base());
    expect(status).toBe(200);
    expect(body.isRepo).toBe(true);
    expect(String(body.base)).toContain('worktrees');
    const primary = worktreesOf(body)[0] as Record<string, unknown>;
    expect(primary.isPrimary).toBe(true);
    expect(primary.branch).toBe('main');
    expect(String(primary.head).length).toBeGreaterThan(0);
    expect(primary.dirty).toBe(0);
  });

  test('a folder with no project binding is refused, not answered for the app root', async () => {
    const { status, body } = await call(listLoader, 'http://localhost/api/worktrees');
    expect(status).toBe(400);
    expect(body.code).toBe('not_a_repo');
  });

  test('MOCK refuses — a demo install has no repository to read', async () => {
    Bun.env.MOCK = 'true';
    const { status, body } = await call(listLoader, base());
    expect(status).toBe(409);
    expect(body.code).toBe('mock_mode');
  });
});

describe('POST /api/worktrees', () => {
  test('creates one, carries the ignored build folder, and the next list shows it', async () => {
    const created = await call(createAction, base(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'new', branch: 'wt/route-created' }),
    });

    expect(created.status).toBe(200);
    const worktree = created.body.worktree as Record<string, unknown>;
    expect(worktree.branch).toBe('wt/route-created');
    // The carry is the one capability git does not provide; without it the new
    // checkout cannot run the project.
    const carried = worktree.carried as { copied: string[] };
    expect(carried.copied).toContain('node_modules');

    const listed = await call(listLoader, base());
    const row = worktreesOf(listed.body).find((entry) => entry.branch === 'wt/route-created');
    expect(row).toBeDefined();
    expect(row?.isPrimary).toBe(false);
    expect(row?.startRef).toBe('HEAD');
  });

  test('a refusal answers its code and field, so the dialog can mark the input', async () => {
    const refused = await call(createAction, base(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'existing', branch: 'main' }),
    });
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe('branch_in_use');
    expect(refused.body.field).toBe('branch');
  });

  test('validate answers the same refusal without creating anything', async () => {
    const result = await call(validateAction, base(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'new', branch: 'has space' }),
    });
    expect(result.status).toBe(400);
    expect(result.body.ok).toBe(false);
    const failures = result.body.failures as Array<{ code: string }>;
    expect(failures[0]?.code).toBe('invalid_name');

    // Nothing was created: the fixture repository is shared by this file, so the
    // assertion names the branch rather than a count (a count would also pin how
    // many earlier tests happened to leave behind).
    const listed = await call(listLoader, base());
    expect(worktreesOf(listed.body).some((entry) => entry.branch === 'has-space')).toBe(false);
    expect(worktreesOf(listed.body).some((entry) => entry.branch === 'has space')).toBe(false);
  });
});

describe('DELETE /api/worktrees', () => {
  test('removes the worktree and its branch, and the list no longer shows it', async () => {
    const created = await call(createAction, base(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'new', branch: 'wt/route-remove' }),
    });
    const path = String((created.body.worktree as Record<string, unknown>).path);

    const removed = await call(removeAction, base(), {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path, deleteBranch: true }),
    });
    expect(removed.status).toBe(200);
    expect(removed.body.removed).toBe(true);
    expect(removed.body.branchDeleted).toBe(true);

    const listed = await call(listLoader, base());
    expect(worktreesOf(listed.body).some((entry) => entry.path === path)).toBe(false);
  });

  test('a missing path is refused by name, not by a crash', async () => {
    const refused = await call(removeAction, base(), {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe('invalid_name');
  });
});
