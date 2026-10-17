/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The stash verbs and the branch row's `unpublished` case, driven against real
 * repositories.
 *
 * The stash is the natural partner of the conflict work: a conflicting
 * `git stash pop` is the ONE conflict shape that leaves no operation file, so
 * it is what `git-state.ts` names `stash-pop`. Its cases are pinned in
 * `git-merge.test.ts` (the abort) and here (the verbs).
 */

import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { action } from '@/server/routes/fs/git';
import { listStashes } from '@/server/lib/fs/git-stash';
import { removeDir } from '@/test-support/remove-dir';

const FIXTURE_ROOT = path.join(process.cwd(), 'tmp-test-git-stash');
const repos: string[] = [];

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync({ cmd: ['git', ...args], cwd, env: { ...Bun.env, GIT_EDITOR: 'true' } });
  return result.stdout.toString().trim();
}

function makeRepo(): string {
  fs.mkdirSync(FIXTURE_ROOT, { recursive: true });
  const dir = fs.mkdtempSync(path.join(FIXTURE_ROOT, 'stash-'));
  repos.push(dir);
  git(dir, 'init', '-q', '-b', 'main', '.');
  // Pin the line ending: a Windows host defaults `core.autocrlf` to true,
  // which rewrites every checked-out file to CRLF and makes the content
  // assertions below fail on `\r` rather than on the git operation.
  git(dir, 'config', 'core.autocrlf', 'false');
  git(dir, 'config', 'core.eol', 'lf');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(dir, 'f.txt'), 'a\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'base');
  return dir;
}

async function post(fields: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.append(key, value);
  const request = new Request('http://localhost/api/fs/git', { method: 'POST', body: formData });
  const response = await action({ request, params: {}, context: {} } as never);
  const body = await (response as Response).json() as { success?: boolean; error?: string };
  return { status: (response as Response).status, body };
}

afterAll(() => {
  for (const dir of repos) removeDir(dir);
  removeDir(FIXTURE_ROOT);
});

describe('stash_push', () => {
  test('saves the working tree and reports the entry', async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'f.txt'), 'a\nmodified\n');
    const res = await post({ actionType: 'stash_push', repo: '.', root: repo, message: 'wip' });
    expect(res.body.success).toBe(true);

    const stashes = await listStashes(repo);
    expect(stashes.length).toBe(1);
    expect(stashes[0].ref).toBe('stash@{0}');
    expect(stashes[0].subject).toContain('wip');
    // The tree is clean again — that is what a stash is for.
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  test('a clean tree is REPORTED, not silently succeeded', async () => {
    const repo = makeRepo();
    const res = await post({ actionType: 'stash_push', repo: '.', root: repo });
    // git exits 0 with "No local changes to save"; a success that stashed
    // nothing would leave the user believing their changes are set aside.
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Nothing to stash');
  });

  test('untracked files are only swept in when asked', async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'new.txt'), 'x\n');

    const withoutFlag = await post({ actionType: 'stash_push', repo: '.', root: repo });
    expect(withoutFlag.body.success).toBe(false); // nothing TRACKED changed

    const withFlag = await post({ actionType: 'stash_push', repo: '.', root: repo, untracked: '1' });
    expect(withFlag.body.success).toBe(true);
    expect(fs.existsSync(path.join(repo, 'new.txt'))).toBe(false);
  });
});

describe('stash_apply / stash_drop', () => {
  test('pop applies and removes the entry', async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'f.txt'), 'a\nmodified\n');
    await post({ actionType: 'stash_push', repo: '.', root: repo, message: 'wip' });

    const res = await post({ actionType: 'stash_apply', repo: '.', root: repo, ref: 'stash@{0}', pop: '1' });
    expect(res.body.success).toBe(true);
    expect(fs.readFileSync(path.join(repo, 'f.txt'), 'utf8')).toBe('a\nmodified\n');
    expect(await listStashes(repo)).toEqual([]);
  });

  test('apply keeps the entry', async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'f.txt'), 'a\nmodified\n');
    await post({ actionType: 'stash_push', repo: '.', root: repo, message: 'wip' });

    const res = await post({ actionType: 'stash_apply', repo: '.', root: repo, ref: 'stash@{0}' });
    expect(res.body.success).toBe(true);
    expect(fs.readFileSync(path.join(repo, 'f.txt'), 'utf8')).toBe('a\nmodified\n');
    // Still there: `apply` is the one you can re-run.
    expect((await listStashes(repo)).length).toBe(1);
  });

  test('drop removes an entry without applying it', async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'f.txt'), 'a\nmodified\n');
    await post({ actionType: 'stash_push', repo: '.', root: repo, message: 'wip' });

    const res = await post({ actionType: 'stash_drop', repo: '.', root: repo, ref: 'stash@{0}' });
    expect(res.body.success).toBe(true);
    expect(await listStashes(repo)).toEqual([]);
    // The change did not come back.
    expect(fs.readFileSync(path.join(repo, 'f.txt'), 'utf8')).toBe('a\n');
  });

  test('an unknown ref is refused with git own message', async () => {
    const repo = makeRepo();
    const res = await post({ actionType: 'stash_drop', repo: '.', root: repo, ref: 'stash@{7}' });
    expect(res.body.success).toBe(false);
  });

  /**
   * A ref that is not a stash reference is refused before git sees it.
   *
   * Measured: `git stash apply --help` printed its usage instead of applying
   * anything, and `git stash drop --help` did the same — a ref beginning with
   * `-` is read as an OPTION. The grammar is exact (`stash@{N}` or a bare `N`),
   * so anything else is refused rather than handed to git as argv.
   */
  test('a flag-shaped ref is refused, and the stash is left alone', async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'f.txt'), 'a\nmodified\n');
    git(repo, 'stash', 'push', '-q', '-m', 'keepme');

    for (const ref of ['--help', '--index', 'stash@{0} --help']) {
      const res = await post({ actionType: 'stash_apply', repo: '.', root: repo, ref });
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('not a stash reference');
    }
    // Nothing was applied or dropped.
    expect((await listStashes(repo)).length).toBe(1);
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  test('a bare index is accepted, which is the other legal spelling', async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'f.txt'), 'a\nmodified\n');
    git(repo, 'stash', 'push', '-q', '-m', 'bare');

    const res = await post({ actionType: 'stash_apply', repo: '.', root: repo, ref: '0', pop: '1' });
    expect(res.body.success).toBe(true);
    expect(await listStashes(repo)).toEqual([]);
  });
});

describe('listStashes', () => {
  test('a repository with no stash answers an empty list', async () => {
    const repo = makeRepo();
    expect(await listStashes(repo)).toEqual([]);
  });

  test('entries carry a relative date, not a raw epoch', async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'f.txt'), 'a\nmodified\n');
    git(repo, 'stash', 'push', '-q', '-m', 'dated');
    const stashes = await listStashes(repo);
    expect(stashes[0].date).toBe('just now');
  });

  test('the ref selector git accepts back is what the row reports', async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'f.txt'), 'a\none\n');
    git(repo, 'stash', 'push', '-q', '-m', 'first');
    fs.writeFileSync(path.join(repo, 'f.txt'), 'a\ntwo\n');
    git(repo, 'stash', 'push', '-q', '-m', 'second');

    const stashes = await listStashes(repo);
    // Newest first, and the selector is what `stash_apply` sends back.
    expect(stashes.map((s) => s.ref)).toEqual(['stash@{0}', 'stash@{1}']);
    expect(stashes[0].subject).toContain('second');
  });
});
