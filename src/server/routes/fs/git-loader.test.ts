/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The git loader's on-demand read branches, driven through the real handler.
 *
 * The amend draft's read is the one under test: the commit box asks for it by
 * QUERY PARAMETER (`?headMessage=1`), so a renamed parameter does not fail —
 * the branch simply never runs, the panel seeds nothing, and the user is asked
 * to retype the message the amend is about to replace. That is a silent
 * failure, which is why the contract is pinned here rather than only through
 * the browser spec.
 *
 * The scope rules are the other half: the read is answered for the repo the
 * panel is showing, so a nested repository's HEAD is not read off the root.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { loader } from '@/server/routes/fs/git';
import { removeDir } from '@/test-support/remove-dir';

/**
 * Inside the app root, because that is the route's own allow-list: `resolveRoot`
 * honors the app root, a path below it, or a registered workspace, and a
 * fixture in `/tmp` would be silently swapped for the chamber's own tree.
 */
const FIXTURE_ROOT = path.join(process.cwd(), 'tmp-test-git-loader');
const repos: string[] = [];

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync({ cmd: ['git', ...args], cwd, env: { ...Bun.env, GIT_EDITOR: 'true' } });
  return result.stdout.toString().trim();
}

/** A repository holding one commit whose message is `message`. */
function makeRepo(message: string): string {
  fs.mkdirSync(FIXTURE_ROOT, { recursive: true });
  const dir = fs.mkdtempSync(path.join(FIXTURE_ROOT, 'repo-'));
  repos.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(dir, 'f.txt'), 'a\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
  return dir;
}

async function read(fields: { root: string; repo?: string; headMessage?: string }) {
  const url = new URL('http://localhost/api/fs/git');
  url.searchParams.set('root', fields.root);
  if (fields.repo) url.searchParams.set('repo', fields.repo);
  if (fields.headMessage) url.searchParams.set('headMessage', fields.headMessage);
  const res = await loader({ request: new Request(url) } as never);
  return { status: res.status, body: (await res.json()) as { message?: string | null; branch?: string } };
}

afterAll(() => {
  for (const dir of repos) removeDir(dir);
  removeDir(FIXTURE_ROOT);
});

describe('the git loader headMessage read', () => {
  test('?headMessage=1 answers HEAD\'s message', async () => {
    const repo = makeRepo('feat(git): previous subject');
    const { status, body } = await read({ root: repo, headMessage: '1' });
    expect(status).toBe(200);
    expect(body.message).toBe('feat(git): previous subject');
  });

  test('a multi-line message arrives whole', async () => {
    const repo = makeRepo('subject');
    fs.writeFileSync(path.join(repo, 'g.txt'), 'b\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'a subject', '-m', 'a body');
    const { body } = await read({ root: repo, headMessage: '1' });
    expect(body.message).toBe('a subject\n\na body');
  });

  test('without the parameter the read is a status payload, not a message', async () => {
    const repo = makeRepo('base');
    const { body } = await read({ root: repo });
    expect(body.message).toBeUndefined();
    expect(body.branch).toBe('main');
  });

  test('a nested repo\'s HEAD is read, not the root\'s', async () => {
    const outer = makeRepo('outer subject');
    const nested = path.join(outer, 'nested');
    fs.mkdirSync(nested);
    git(nested, 'init', '-q', '-b', 'main');
    git(nested, 'config', 'user.email', 'test@example.invalid');
    git(nested, 'config', 'user.name', 'Test');
    fs.writeFileSync(path.join(nested, 'f.txt'), 'n\n');
    git(nested, 'add', '-A');
    git(nested, 'commit', '-q', '-m', 'nested subject');

    const { body } = await read({ root: outer, repo: 'nested', headMessage: '1' });
    expect(body.message).toBe('nested subject');
  });
});
