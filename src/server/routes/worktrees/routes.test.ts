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
import { clearSessionFileCaches } from '@/server/lib/omp/session/files';
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
/** Where the session files live, so a count can be observed without omp. */
let sessionsRoot: string;
const saved = {
  MOCK: Bun.env.MOCK,
  SYNC_WORKSPACE: Bun.env.SYNC_WORKSPACE,
  agentDir: Bun.env.PI_CODING_AGENT_DIR,
  xdg: Bun.env.XDG_DATA_HOME,
  dataDir: Bun.env.KABMO_DATA_DIR,
};

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

/** Put an env var back, or unset it when the file started without one. */
function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete Bun.env[name];
  else Bun.env[name] = value;
}

/** One session file whose cwd is `cwd`, as the agent would record it. */
function writeSession(id: string, cwd: string): void {
  const lines = [
    JSON.stringify({ type: 'session', id, cwd, timestamp: '2026-10-23T00:00:00.000Z' }),
    JSON.stringify({
      type: 'message',
      id: `${id}-m1`,
      parentId: null,
      timestamp: '2026-10-23T00:00:01.000Z',
      message: { role: 'user', content: 'where am I' },
    }),
  ];
  writeFileSync(join(sessionsRoot, 'project', `${id}.jsonl`), `${lines.join('\n')}\n`);
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

  // A sessions root of this file's own: the worktree count reads it, and
  // without the override it would scan the developer's real `~/.omp/agent`.
  const agent = join(workRoot, 'agent');
  sessionsRoot = join(agent, 'sessions');
  mkdirSync(join(sessionsRoot, 'project'), { recursive: true });
  Bun.env.PI_CODING_AGENT_DIR = agent;
  // XDG would redirect the sessions dir to $XDG_DATA_HOME/omp when it exists.
  delete Bun.env.XDG_DATA_HOME;
  // A worktree's default location is `<data>/worktrees/<projectId>/<name>`, so
  // without this the suite writes into the developer's own `~/.kabmo`.
  Bun.env.KABMO_DATA_DIR = join(workRoot, 'data');
});

beforeEach(async () => {
  await isolateDb();
  Bun.env.MOCK = 'false';
  Bun.env.SYNC_WORKSPACE = 'false';
  const db = await getDb();
  await db.run('INSERT INTO workspace_folders (name, project_path) VALUES (?, ?)', ['proj', repo]);
});

afterEach(async () => {
  await invalidateWorktreeTopology();
  // The session-file caches are keyed on `globalThis` and this file writes
  // session files, so a case that leaves one behind would be counted by the next.
  clearSessionFileCaches();
  await releaseDb();
});

afterAll(() => {
  removeDir(workRoot);
  // Explicitly mapped: the record's keys are not the env names, and an
  // `Object.entries` restore would silently leave `PI_CODING_AGENT_DIR` pointed
  // at a directory this file just deleted.
  restoreEnv('MOCK', saved.MOCK);
  restoreEnv('SYNC_WORKSPACE', saved.SYNC_WORKSPACE);
  restoreEnv('PI_CODING_AGENT_DIR', saved.agentDir);
  restoreEnv('XDG_DATA_HOME', saved.xdg);
  restoreEnv('KABMO_DATA_DIR', saved.dataDir);
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

  test('counts a session running in a worktree that lives OUTSIDE the repository', async () => {
    const created = await call(createAction, base(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'new', branch: 'wt/route-counted' }),
    });
    const path = String((created.body.worktree as Record<string, unknown>).path);
    // The default location is under the data directory, not inside the checkout
    // — which is the case a `primaryRoot` prefix test counted zero for.
    expect(path.startsWith(repo)).toBe(false);

    writeSession('route-counted-session', path);

    const listed = await call(listLoader, base());
    const row = worktreesOf(listed.body).find((entry) => entry.path === path);
    // The number the delete dialog warns with: a chat is running here.
    expect(row?.sessions).toBe(1);
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

  test('a dirty worktree is refused with 409 and its count, so a caller can tell a retry from a bad request', async () => {
    const created = await call(createAction, base(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'new', branch: 'wt/route-dirty' }),
    });
    const path = String((created.body.worktree as Record<string, unknown>).path);
    writeFileSync(join(path, 'scratch.txt'), 'not committed\n');

    const refused = await call(removeAction, base(), {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path, deleteBranch: true }),
    });
    // 409: the request is well-formed and the tree is the obstacle — the same
    // distinction `mock_mode` draws. A 400 here reads as "fix your request".
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('dirty');
    expect(Number(refused.body.count)).toBeGreaterThan(0);

    // A refusal is not a partial removal.
    const listed = await call(listLoader, base());
    expect(worktreesOf(listed.body).some((entry) => entry.path === path)).toBe(true);
  });
});
