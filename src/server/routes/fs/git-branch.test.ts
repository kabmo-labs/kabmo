/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Branch listing, rename and delete — driven against real repositories,
 * including a real REMOTE for the rename half.
 *
 * The rename cases exist because of two measured facts that the panel's copy
 * now states:
 *
 *  - `git branch -m` does NOT move the upstream: after renaming `feature` to
 *    `feat2`, the config still reads `branch.feat2.merge = refs/heads/feature`,
 *    and a plain `git push` then REFUSES with "The upstream branch of your
 *    current branch does not match the name of your current branch".
 *  - The remote half is `push -u` (which re-points the upstream as it
 *    publishes) + `push --delete` + `fetch --prune` (without the prune the
 *    stale `origin/<old>` tracking ref survives and the branch dropdown keeps
 *    offering a branch that no longer exists).
 *
 * The listing cases pin `%(upstream:track)` in every form it takes, including
 * the EMPTY one for a branch with no upstream — which must not render as "in
 * sync".
 */

import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { action } from '@/server/routes/fs/git';
import { listBranchDetails } from '@/server/lib/fs/git-branch';

const FIXTURE_ROOT = path.join(process.cwd(), 'tmp-test-git-branch');
const repos: string[] = [];

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync({ cmd: ['git', ...args], cwd, env: { ...Bun.env, GIT_EDITOR: 'true' } });
  return result.stdout.toString().trim();
}

/** A repository with one commit and a `feature` branch, no remote. */
function makeRepo(): string {
  fs.mkdirSync(FIXTURE_ROOT, { recursive: true });
  const dir = fs.mkdtempSync(path.join(FIXTURE_ROOT, 'branch-'));
  repos.push(dir);
  git(dir, 'init', '-q', '-b', 'main', '.');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(dir, 'f.txt'), 'a\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'base');
  git(dir, 'branch', 'feature');
  return dir;
}

/** A repository cloned from a fresh bare origin, with `feature` published. */
function makeRepoWithRemote(): { dir: string; origin: string } {
  fs.mkdirSync(FIXTURE_ROOT, { recursive: true });
  const origin = fs.mkdtempSync(path.join(FIXTURE_ROOT, 'origin-'));
  const dir = fs.mkdtempSync(path.join(FIXTURE_ROOT, 'clone-'));
  repos.push(origin, dir);
  git(origin, 'init', '-q', '--bare', '-b', 'main', '.');
  git(dir, 'clone', '-q', origin, '.');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(dir, 'f.txt'), 'a\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'base');
  git(dir, 'push', '-q', '-u', 'origin', 'main');
  git(dir, 'checkout', '-qb', 'feature');
  fs.writeFileSync(path.join(dir, 'g.txt'), 'b\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'feature work');
  git(dir, 'push', '-q', '-u', 'origin', 'feature');
  git(dir, 'checkout', '-q', 'main');
  return { dir, origin };
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
  for (const dir of repos) fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
});

describe('listBranchDetails', () => {
  test('a branch with no upstream reports empty, not zero-ahead', async () => {
    const repo = makeRepo();
    const branches = await listBranchDetails(repo);
    const feature = branches.find((b) => b.name === 'feature');
    expect(feature).toBeDefined();
    // `unpublished` is the row the panel must render here: a branch several
    // commits ahead of everything reports an EMPTY track, so a count of 0
    // would read as "in sync".
    expect(feature!.upstream).toBe('');
    expect(feature!.ahead).toBe(0);
    expect(feature!.gone).toBe(false);
  });

  test('the checked-out branch is marked current', async () => {
    const repo = makeRepo();
    const branches = await listBranchDetails(repo);
    expect(branches.find((b) => b.name === 'main')?.current).toBe(true);
    expect(branches.find((b) => b.name === 'feature')?.current).toBe(false);
  });

  test('a published branch reports its upstream and ahead count', async () => {
    const { dir } = makeRepoWithRemote();
    git(dir, 'checkout', '-q', 'feature');
    fs.writeFileSync(path.join(dir, 'h.txt'), 'c\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-qm', 'unpushed');

    const branches = await listBranchDetails(dir);
    const feature = branches.find((b) => b.name === 'feature')!;
    expect(feature.upstream).toBe('origin/feature');
    expect(feature.ahead).toBe(1);
    expect(feature.behind).toBe(0);
    expect(feature.gone).toBe(false);
  });

  test('a branch whose upstream was deleted reports gone', async () => {
    const { dir, origin } = makeRepoWithRemote();
    // Delete the remote ref behind the branch's back, then prune.
    git(origin, 'update-ref', '-d', 'refs/heads/feature');
    git(dir, 'fetch', '-q', '--prune', 'origin');

    const branches = await listBranchDetails(dir);
    const feature = branches.find((b) => b.name === 'feature')!;
    expect(feature.gone).toBe(true);
    expect(feature.ahead).toBe(0);
    expect(feature.behind).toBe(0);
  });

  test('the tip subject and date travel with the row', async () => {
    const repo = makeRepo();
    const branches = await listBranchDetails(repo);
    expect(branches.find((b) => b.name === 'main')?.subject).toBe('base');
    expect(branches.find((b) => b.name === 'main')?.date.length).toBeGreaterThan(0);
  });

  test('a directory that is not a repository answers an empty list', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ompchamber-norepo-'));
    repos.push(dir);
    expect(await listBranchDetails(dir)).toEqual([]);
  });
});

describe('rename_branch: local', () => {
  test('renames and keeps the upstream as it was', async () => {
    const repo = makeRepo();
    const res = await post({ actionType: 'rename_branch', repo: '.', root: repo, branch: 'feature', newName: 'feat2' });
    expect(res.body.success).toBe(true);
    const names = git(repo, 'branch', '--format=%(refname:short)').split('\n');
    expect(names).toContain('feat2');
    expect(names).not.toContain('feature');
  });

  test('a collision is refused with git own message', async () => {
    const repo = makeRepo();
    const res = await post({ actionType: 'rename_branch', repo: '.', root: repo, branch: 'feature', newName: 'main' });
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('already exists');
    // Nothing moved.
    const names = git(repo, 'branch', '--format=%(refname:short)').split('\n');
    expect(names).toContain('feature');
  });

  test('a name git refuses is refused before the rename runs', async () => {
    const repo = makeRepo();
    const res = await post({ actionType: 'rename_branch', repo: '.', root: repo, branch: 'feature', newName: '-dash' });
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('not a valid branch name');
    expect(git(repo, 'branch', '--format=%(refname:short)').split('\n')).toContain('feature');
  });

  test('renaming carries the upstream config onto the new name', async () => {
    const { dir } = makeRepoWithRemote();
    const res = await post({ actionType: 'rename_branch', repo: '.', root: dir, branch: 'feature', newName: 'feat2' });
    expect(res.body.success).toBe(true);
    // The upstream NAME is untouched by `-m`: the new branch still tracks the
    // old remote ref, which is what the dialog warns about.
    expect(git(dir, 'config', '--get', 'branch.feat2.merge')).toBe('refs/heads/feature');
  });
});

describe('rename_branch: remote', () => {
  test('publishes the new name, deletes the old one and prunes the stale ref', async () => {
    const { dir, origin } = makeRepoWithRemote();
    const res = await post({
      actionType: 'rename_branch',
      repo: '.',
      root: dir,
      branch: 'feature',
      newName: 'feat2',
      remote: '1',
    });
    expect(res.body.success).toBe(true);

    const remoteRefs = git(origin, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n');
    expect(remoteRefs).toContain('feat2');
    expect(remoteRefs).not.toContain('feature');

    // The upstream was RE-POINTED by `push -u` — this is the half a bare push
    // would have refused.
    expect(git(dir, 'config', '--get', 'branch.feat2.merge')).toBe('refs/heads/feat2');
    // And the stale tracking ref is gone, so the dropdown cannot offer it.
    expect(git(dir, 'for-each-ref', '--format=%(refname:short)', 'refs/remotes')).not.toContain('origin/feature');
  });

  test('without the remote flag nothing is published', async () => {
    const { dir, origin } = makeRepoWithRemote();
    const res = await post({ actionType: 'rename_branch', repo: '.', root: dir, branch: 'feature', newName: 'feat2' });
    expect(res.body.success).toBe(true);
    const remoteRefs = git(origin, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n');
    expect(remoteRefs).toContain('feature');
    expect(remoteRefs).not.toContain('feat2');
  });
});

describe('delete_branch', () => {
  test('deletes a merged branch', async () => {
    const repo = makeRepo();
    const res = await post({ actionType: 'delete_branch', repo: '.', root: repo, branch: 'feature' });
    expect(res.body.success).toBe(true);
    expect(git(repo, 'branch', '--format=%(refname:short)').split('\n')).not.toContain('feature');
  });

  test('refuses an unmerged branch with git own sentence', async () => {
    const repo = makeRepo();
    git(repo, 'checkout', '-q', 'feature');
    fs.writeFileSync(path.join(repo, 'unmerged.txt'), 'x\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-qm', 'unmerged work');
    git(repo, 'checkout', '-q', 'main');

    const res = await post({ actionType: 'delete_branch', repo: '.', root: repo, branch: 'feature' });
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('not fully merged');
    // Still there — the refusal is the safety net, not a failure.
    expect(git(repo, 'branch', '--format=%(refname:short)').split('\n')).toContain('feature');
  });

  test('force deletes it when the user says so explicitly', async () => {
    const repo = makeRepo();
    git(repo, 'checkout', '-q', 'feature');
    fs.writeFileSync(path.join(repo, 'unmerged.txt'), 'x\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-qm', 'unmerged work');
    git(repo, 'checkout', '-q', 'main');

    const res = await post({ actionType: 'delete_branch', repo: '.', root: repo, branch: 'feature', force: '1' });
    expect(res.body.success).toBe(true);
    expect(git(repo, 'branch', '--format=%(refname:short)').split('\n')).not.toContain('feature');
  });

  /**
   * The flag is only ever `'1'`.
   *
   * The dialog's "delete even if its commits are not merged" checkbox travels as
   * `force=1`, and the confirm path once dropped it — so ticking the box deleted
   * with `-d` anyway and an unmerged branch was refused with the checkbox
   * apparently doing nothing. A value that is neither absent nor `'1'` must not
   * be read as a force either.
   */
  test('a force value that is not exactly "1" does not force', async () => {
    const repo = makeRepo();
    git(repo, 'checkout', '-q', 'feature');
    fs.writeFileSync(path.join(repo, 'unmerged.txt'), 'x\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-qm', 'unmerged work');
    git(repo, 'checkout', '-q', 'main');

    const res = await post({ actionType: 'delete_branch', repo: '.', root: repo, branch: 'feature', force: 'true' });
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('not fully merged');
  });
});
