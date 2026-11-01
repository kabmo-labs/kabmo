/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The skills route's catalog-source and git-import contract.
 *
 * Every case here pins a request shape the client depends on and that the server
 * used to get wrong:
 *
 * - **`catalogSources` used to be a write nobody read.** The client sent
 *   `{ catalogSources: [...] }`, which matched no branch and came back `400
 *   Unsupported skill action` behind a `.catch(console.error)` — so "Add your own
 *   source" reported success and changed nothing. Adding a source now has its own
 *   `type`, refuses a duplicate repository, and answers the stored list.
 * - **A source carries no invented metadata.** `skillCount` is `null` until a
 *   scan reports a real one, and the old `stars`/`updatedAt` literals are dropped
 *   on read instead of being passed through a narrower type.
 * - **With no query, the scope is the app root, and a project install needs a
 *   workspace.** `install_git_skills` therefore refuses rather than falling back
 *   to the user root behind the user's back.
 * - **MOCK answers 409 for every operation that would spawn a process.** A demo
 *   install that reports success while nothing is cloned is worse than a refusal.
 *
 * The DB is a temp file and the agent dir a temp tree, so nothing reaches the
 * developer's real `~/.kabmo` or `~/.omp`.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getDb } from '@/server/db.server';
import { action as skillsAction, loader as skillsLoader } from '@/server/routes/settings/skills';
import { removeDir } from '@/test-support/remove-dir';

const API = 'http://localhost/api/settings/skills';
const ROOT = join(tmpdir(), 'kabmo-skill-routes-test');
const AGENT_DIR = join(ROOT, 'agent');
const WORKSPACE = join(ROOT, 'workspace');
const REPO = join(ROOT, 'repo');

type Handler = (args: never) => unknown;

function call(handler: Handler, request: Request): Promise<Response> {
  return handler({ request, params: {} } as never) as Promise<Response>;
}

function send(body: unknown): Request {
  return new Request(API, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function writeSkill(dir: string, frontmatter: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\n\nbody\n`);
}

beforeAll(async () => {
  removeDir(ROOT);
  fs.mkdirSync(AGENT_DIR, { recursive: true });
  fs.mkdirSync(WORKSPACE, { recursive: true });
  writeSkill(join(REPO, 'skills', 'alpha'), 'name: alpha\ndescription: First skill');
  writeSkill(join(REPO, 'skills', 'beta'), 'name: beta\ndescription: Second skill');
  // A real repository: the installer clones, and a plain directory is not clonable.
  Bun.spawnSync({ cmd: ['git', 'init', '--quiet'], cwd: REPO });
  Bun.spawnSync({ cmd: ['git', 'add', '.'], cwd: REPO });
  Bun.spawnSync({
    cmd: ['git', '-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qm', 'init'],
    cwd: REPO,
  });

  Bun.env.PI_CODING_AGENT_DIR = AGENT_DIR;
  Bun.env.KABMO_DB_PATH = join(ROOT, 'db.sqlite');
  Bun.env.SYNC_WORKSPACE = 'false';
  delete Bun.env.MOCK;
  globalThis.__kabmoDb = undefined;
  await getDb();
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

describe('catalog sources', () => {
  test('the defaults report an unscanned count rather than a number', async () => {
    const body = await (await call(skillsLoader, new Request(API))).json();
    expect(Array.isArray(body.catalogSources)).toBe(true);
    expect(body.catalogSources.every((source: { skillCount: unknown }) => source.skillCount === null)).toBe(true);
    expect(body.catalogSources.some((source: { stars?: unknown }) => source.stars !== undefined)).toBe(false);
  });

  test('adding a source stores a normalised repo slug and answers the list', async () => {
    const res = await call(skillsAction, send({ type: 'add_source', repo: 'https://github.com/acme/skills', name: 'Acme' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toMatchObject({ name: 'Acme', repo: 'acme/skills', skillCount: null, isCustom: true });
    expect(body.catalogSources.at(-1).repo).toBe('acme/skills');

    const reloaded = await (await call(skillsLoader, new Request(API))).json();
    expect(reloaded.catalogSources.at(-1).repo).toBe('acme/skills');
  });

  test('the same repository twice is a 409, not a second card', async () => {
    const res = await call(skillsAction, send({ type: 'add_source', repo: 'acme/skills' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('already a source');
  });

  test('an unusable repo is a 400', async () => {
    const res = await call(skillsAction, send({ type: 'add_source', repo: 'not a repo' }));
    expect(res.status).toBe(400);
  });

  test('removing a source drops it, and an unknown id is a 404', async () => {
    const list = await (await call(skillsLoader, new Request(API))).json();
    const id = list.catalogSources.at(-1).id;
    const removed = await call(skillsAction, send({ type: 'remove_source', id }));
    expect(removed.status).toBe(200);
    expect((await removed.json()).catalogSources.some((source: { id: string }) => source.id === id)).toBe(false);

    expect((await call(skillsAction, send({ type: 'remove_source', id }))).status).toBe(404);
  });
});

describe('git inspection and install', () => {
  test('an inspect on MOCK is refused instead of inventing a repository', async () => {
    Bun.env.MOCK = 'true';
    try {
      const res = await call(skillsAction, send({ type: 'inspect_git_repo', url: REPO }));
      expect(res.status).toBe(409);
    } finally {
      delete Bun.env.MOCK;
    }
  });

  test('install with no selection is a 400', async () => {
    const res = await call(skillsAction, send({ type: 'install_git_skills', url: REPO, paths: [] }));
    expect(res.status).toBe(400);
  });

  test('a project install with no workspace is refused, not redirected to another root', async () => {
    // `?scope=user` is the request with no workspace. A create made there while
    // the draft says `project` must be refused: writing it to the user root
    // instead is how a skill "vanishes" from the list the user was looking at,
    // and writing it under the server's cwd is how a test leaked a real
    // `<repo>/.omp/skills/alpha` once.
    const res = await call(
      skillsAction,
      new Request(`${API}?scope=user`, {
        method: 'POST',
        body: JSON.stringify({
          type: 'install_git_skills',
          url: REPO,
          paths: ['skills/alpha'],
          mode: 'managed_copy',
          location: 'project',
        }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('workspace');
    expect(fs.existsSync(join(AGENT_DIR, 'skills', 'alpha'))).toBe(false);
  });

  test('a user-scope install lands in the agent dir', async () => {
    const res = await call(
      skillsAction,
      new Request(`${API}?scope=user`, {
        method: 'POST',
        body: JSON.stringify({ type: 'install_git_skills', url: REPO, paths: ['skills/alpha'], mode: 'managed_copy', location: 'user' }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    const body = await res.json();
    expect(body.installed).toEqual(['alpha']);
    expect(fs.existsSync(join(AGENT_DIR, 'skills', 'alpha', 'SKILL.md'))).toBe(true);
  });

  test('a request that names no location installs into the USER root, not the server cwd', async () => {
    // Measured: the catalog pane sends no root and no location, and a `project`
    // default wrote the copy into `<server cwd>/.omp/skills` — the repository
    // Kabmo was started from — while the user was looking at a user-scope list.
    const before = fs.existsSync(join(process.cwd(), '.omp', 'skills', 'beta'));
    const res = await call(
      skillsAction,
      new Request(API, {
        method: 'POST',
        body: JSON.stringify({ type: 'install_git_skills', url: REPO, paths: ['skills/beta'], mode: 'managed_copy' }),
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(res.status).toBe(200);
    expect(fs.existsSync(join(AGENT_DIR, 'skills', 'beta', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(join(process.cwd(), '.omp', 'skills', 'beta'))).toBe(before);
  });

  test('installing the same skill again is skipped with the reason', async () => {
    const request = () =>
      new Request(`${API}?scope=user`, {
        method: 'POST',
        body: JSON.stringify({ type: 'install_git_skills', url: REPO, paths: ['skills/alpha'], mode: 'managed_copy', location: 'user' }),
        headers: { 'content-type': 'application/json' },
      });
    const body = await (await call(skillsAction, request())).json();
    expect(body.installed).toEqual([]);
    expect(body.skipped[0].reason).toContain('already installed');
  });

  test('catalog search with an empty query answers nothing and spawns nothing', async () => {
    const body = await (await call(skillsAction, send({ type: 'search_catalog', q: '   ' }))).json();
    expect(body.catalogSkills).toEqual([]);
  });
});
