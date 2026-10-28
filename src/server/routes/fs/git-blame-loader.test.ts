/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The git loader's blame branches, driven through the real handler.
 *
 * The editor asks by QUERY PARAMETER (`?blame=1`, `?blameHistory=1&line=N`), so
 * a renamed parameter does not fail loudly — the branch never runs, the panel
 * shows nothing, and every line of every file looks unattributed. That is the
 * same class of silent failure `git-loader.test.ts` pins for the amend draft,
 * and it is why the contract is asserted here rather than only in a browser.
 *
 * `file` is REPO-relative (the same shape `?fileDiff=1` takes), so the nested
 * case is the one that proves the scope: a path read against the wrong
 * repository resolves to nothing and the answer is an empty history.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { loader } from '@/server/routes/fs/git';
import type { BlameHistory, BlamePayload } from '@/shared/lib/fs/git-blame';
import { removeDir } from '@/test-support/remove-dir';

/** Inside the app root, because `resolveRoot` only honors that or a workspace. */
const FIXTURE_ROOT = path.join(process.cwd(), 'tmp-test-git-blame');
const repos: string[] = [];

function git(cwd: string, ...args: string[]): void {
  const result = Bun.spawnSync({
    cmd: ['git', ...args],
    cwd,
    env: {
      ...Bun.env,
      GIT_EDITOR: 'true',
      GIT_AUTHOR_NAME: 'Ada Lovelace',
      GIT_AUTHOR_EMAIL: 'ada@example.com',
      GIT_COMMITTER_NAME: 'Ada Lovelace',
      GIT_COMMITTER_EMAIL: 'ada@example.com',
    },
  });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
}

function makeRepo(): string {
  fs.mkdirSync(FIXTURE_ROOT, { recursive: true });
  const dir = fs.mkdtempSync(path.join(FIXTURE_ROOT, 'repo-'));
  repos.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'f.ts'), 'alpha\nbeta\ngamma\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'feat: the first commit');
  return dir;
}

async function read(params: Record<string, string>) {
  const url = new URL('http://localhost/api/fs/git');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const res = await loader({ request: new Request(url) } as never);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

afterAll(() => {
  for (const dir of repos) removeDir(dir);
  removeDir(FIXTURE_ROOT);
});

describe('the git loader blame read', () => {
  test('?blame=1 answers the whole file, attributed', async () => {
    const repo = makeRepo();
    const { status, body } = await read({ root: repo, blame: '1', file: 'f.ts' });
    const payload = body as unknown as BlamePayload;

    expect(status).toBe(200);
    expect(payload.available).toBe(true);
    expect(payload.lines).toBe(3);
    expect(payload.runs).toEqual([{ from: 1, to: 3, sha: payload.head! }]);
    expect(payload.commits[payload.head!].author).toBe('Ada Lovelace');
    expect(payload.commits[payload.head!].summary).toBe('feat: the first commit');
  });

  test('a file with no history is an answer, not a 4xx', async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'new.ts'), 'x\n');
    const { status, body } = await read({ root: repo, blame: '1', file: 'new.ts' });
    const payload = body as unknown as BlamePayload;

    expect(status).toBe(200);
    expect(payload.available).toBe(false);
    expect(payload.reason).toBe('untracked');
  });

  test('the path is read against the REPO, not the root', async () => {
    const outer = makeRepo();
    const nested = path.join(outer, 'nested');
    fs.mkdirSync(nested);
    git(nested, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(nested, 'f.ts'), 'one\n');
    git(nested, 'add', '-A');
    git(nested, 'commit', '-q', '-m', 'nested commit');

    const { body } = await read({ root: outer, repo: 'nested', blame: '1', file: 'f.ts' });
    const payload = body as unknown as BlamePayload;
    expect(payload.lines).toBe(1);
    expect(payload.commits[payload.head!].summary).toBe('nested commit');
  });

  test('a missing file parameter is a 400 rather than a read of the root', async () => {
    const repo = makeRepo();
    const { status, body } = await read({ root: repo, blame: '1' });
    expect(status).toBe(400);
    expect(body.error).toBe('file is required');
  });

  test('?blameHistory=1 answers the commits that touched one line', async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'f.ts'), 'alpha\nBETA\ngamma\n');
    git(repo, 'commit', '-q', '-am', 'fix: the middle line');

    const { status, body } = await read({ root: repo, blameHistory: '1', file: 'f.ts', line: '2' });
    const history = body as unknown as BlameHistory;

    expect(status).toBe(200);
    expect(history.entries.map((entry) => entry.summary)).toEqual([
      'fix: the middle line',
      'feat: the first commit',
    ]);
    expect(history.truncated).toBe(false);
  });

  test('a line past the end of the file answers an empty history', async () => {
    const repo = makeRepo();
    const { status, body } = await read({ root: repo, blameHistory: '1', file: 'f.ts', line: '99' });
    expect(status).toBe(200);
    expect((body as unknown as BlameHistory).entries).toEqual([]);
  });

  test('without either parameter the read is still a status payload', async () => {
    const repo = makeRepo();
    const { body } = await read({ root: repo });
    expect(body.branch).toBe('main');
    expect(body.runs).toBeUndefined();
  });
});
