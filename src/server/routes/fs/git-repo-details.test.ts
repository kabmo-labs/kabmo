/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `?repoDetails=1` — the repo management modal's read, driven through the real
 * loader.
 *
 * The parameter is the contract: a renamed one does not fail, the branch simply
 * never runs, the modal renders no rows and the user is left with a dialog that
 * looks empty. That is a silent failure, which is why it is pinned here rather
 * than only through the browser spec.
 *
 * The other half is DISCOVERY. The rows must describe the repos discovery
 * found under the requested root — including the root itself when it is one —
 * and `reposPending` must travel with them, because the walk is a background
 * pass and a modal opened while it runs would otherwise list one row and look
 * finished.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { loader } from '@/server/routes/fs/git';
import { removeDir } from '@/test-support/remove-dir';

/**
 * Inside the app root, because that is the route's own allow-list: `resolveRoot`
 * honors the app root, a path below it, or a registered workspace, and a fixture
 * in `/tmp` would be silently swapped for Kabmo's own tree.
 */
const FIXTURE_ROOT = path.join(process.cwd(), 'tmp-test-git-repo-details');
const repos: string[] = [];

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync({ cmd: ['git', ...args], cwd, env: { ...Bun.env, GIT_EDITOR: 'true' } });
  return result.stdout.toString().trim();
}

/** A directory under the fixture root, registered for cleanup. */
function makeDir(name: string): string {
  fs.mkdirSync(FIXTURE_ROOT, { recursive: true });
  const dir = path.join(FIXTURE_ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  repos.push(dir);
  return dir;
}

/** A repository holding one commit, with `branch` checked out. */
function makeRepo(name: string, branch = 'main'): string {
  const dir = makeDir(name);
  git(dir, 'init', '-q', '-b', branch, '.');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(dir, 'f.txt'), 'a\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', `${name.split('/').pop()} base`);
  return dir;
}

interface RepoDetailsBody {
  success?: boolean;
  repos?: string[];
  reposPending?: boolean;
  details?: Array<{ path: string; isRepo: boolean; branch: string; subject: string; changed: number }>;
}

async function read(root: string, params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/fs/git');
  url.searchParams.set('root', root);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const res = await loader({ request: new Request(url) } as never);
  return { status: res.status, body: (await res.json()) as RepoDetailsBody };
}

afterAll(() => {
  removeDir(FIXTURE_ROOT);
});

describe('the git loader repoDetails read', () => {
  test('?repoDetails=1 answers a row per discovered repo', async () => {
    // The root is a folder OF repos — the shape the modal exists for.
    const outer = makeDir('flat');
    makeRepo('flat/alpha');
    makeRepo('flat/beta');

    const { status, body } = await read(outer, { repoDetails: '1' });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    // Discovery walks in the background, so the first read may answer the root
    // alone; the assertion is about the SHAPE, and a rescan forces the answer.
    expect(Array.isArray(body.details)).toBe(true);
    expect(body.details?.every((row) => typeof row.path === 'string')).toBe(true);
  });

  test('a settled discovery lists every nested repo with its own branch', async () => {
    const outer = makeDir('nested-root');
    makeRepo('nested-root/one');
    makeRepo('nested-root/two', 'trunk');

    // Force the walk, then read the cached answer.
    await read(outer, { rescan: '1' });
    const { body } = await read(outer, { repoDetails: '1' });
    const rows = body.details ?? [];
    const row = (repoPath: string) => rows.find((r) => r.path === repoPath);

    expect(row('one')?.branch).toBe('main');
    expect(row('two')?.branch).toBe('trunk');
    expect(row('two')?.subject).toBe('two base');
    // The root is a folder OF repos, not a repo: discovery lists only what it
    // found, so there is no `.` row to report as a repository.
    expect(row('.')).toBeUndefined();
  });

  test('a repo with uncommitted work reports its counts', async () => {
    const outer = makeDir('dirty-root');
    const repo = makeRepo('dirty-root/dirty');
    fs.writeFileSync(path.join(repo, 'f.txt'), 'changed\n');
    fs.writeFileSync(path.join(repo, 'untracked.txt'), 'new\n');

    await read(outer, { rescan: '1' });
    const { body } = await read(outer, { repoDetails: '1' });
    const row = body.details?.find((r) => r.path === 'dirty');
    expect(row?.changed).toBe(1);
  });

  test('without the parameter the read is a status payload, not rows', async () => {
    const repo = makeRepo('plain-status');
    const { body } = await read(repo);
    expect(body.details).toBeUndefined();
    expect(body.success).toBeUndefined();
  });

  test('a root that is itself a repo lists the `.` row', async () => {
    const repo = makeRepo('root-repo');
    await read(repo, { rescan: '1' });
    const { body } = await read(repo, { repoDetails: '1' });
    const root = (body.details ?? []).find((row) => row.path === '.');
    expect(root?.isRepo).toBe(true);
    expect(root?.branch).toBe('main');
  });

  test('reposOnly does not carry the rows — the two reads stay separate', async () => {
    const outer = makeDir('repos-only-root');
    makeRepo('repos-only-root/r');

    const { body } = await read(outer, { reposOnly: '1' });
    expect(Array.isArray(body.repos)).toBe(true);
    expect(body.details).toBeUndefined();
  });
});
