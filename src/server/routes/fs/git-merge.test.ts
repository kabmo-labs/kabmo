/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Merge, conflict resolution, and the operation trio — driven against real
 * repositories through the route's own action dispatch.
 *
 * Every case here is a decision that was measured before it was written:
 *
 *  - `merge <branch>` vs `merge <sha>`: the SHA form writes
 *    `Merge commit '<sha>'` where the branch form writes `Merge branch '<name>'`.
 *  - `--ours`/`--theirs` are INVERTED in a rebase, which is why the panel
 *    labels its buttons from the conflict markers and never with those words.
 *  - a merge abort on a clean tree exits 128 with a fatal, so the guard is the
 *    state read rather than the exit code.
 *  - a conflicting `stash pop` leaves NO operation file, so every `--abort`
 *    answers "no <op> in progress" and only `reset --merge HEAD` clears it.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { action } from '@/server/routes/fs/git';
import { readGitState } from '@/server/lib/fs/git-state';

/**
 * Scratch fixtures, under a directory this file owns.
 *
 * It MUST be inside the app root: that is the route's own allow-list
 * (`resolveRoot` honors the app root, a path below it, or a registered
 * workspace). A repository in `/tmp` is not addressable through the route at
 * all — `resolveRoot` falls back to the app root's own working tree, so the
 * action ran against THE CHAMBER REPOSITORY.
 */
const FIXTURE_ROOT = path.join(process.cwd(), 'tmp-test-git-merge');
const repos: string[] = [];

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync({ cmd: ['git', ...args], cwd, env: { ...Bun.env, GIT_EDITOR: 'true' } });
  return result.stdout.toString().trim();
}

/** A repository on `main` and `feature` whose two branches edit the same line. */
function makeConflictingRepo(): string {
  fs.mkdirSync(FIXTURE_ROOT, { recursive: true });
  const dir = fs.mkdtempSync(path.join(FIXTURE_ROOT, 'merge-'));
  repos.push(dir);
  git(dir, 'init', '-q', '-b', 'main', '.');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(dir, 'f.txt'), 'a\nb\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'base');
  git(dir, 'checkout', '-qb', 'feature');
  fs.writeFileSync(path.join(dir, 'f.txt'), 'a\nFEAT\n');
  git(dir, 'commit', '-qam', 'feat');
  git(dir, 'checkout', '-q', 'main');
  fs.writeFileSync(path.join(dir, 'f.txt'), 'a\nMAIN\n');
  git(dir, 'commit', '-qam', 'main');
  return dir;
}

/** POST one action through the route, as the panel does. */
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

describe('merge_branch', () => {
  test('a clean merge records the branch NAME in the merge commit', async () => {
    const repo = makeConflictingRepo();
    // Move `feature` onto a file `main` never touches, so the merge is clean.
    git(repo, 'checkout', '-q', 'feature');
    fs.writeFileSync(path.join(repo, 'only-feature.txt'), 'x\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-qm', 'feature work');
    git(repo, 'checkout', '-q', 'main');
    // Revert the shared line on `main` so the branches no longer collide.
    fs.writeFileSync(path.join(repo, 'f.txt'), 'a\nb\n');
    git(repo, 'commit', '-qam', 'main moves off the shared line');

    const res = await post({ actionType: 'merge_branch', repo: '.', root: repo, branch: 'feature' });
    expect(res.body.success).toBe(true);
    // The whole reason the branch form exists: `merge <sha>` would say
    // `Merge commit '<sha>'` here.
    expect(git(repo, 'log', '-1', '--pretty=%s')).toBe("Merge branch 'feature'");
  });

  test('a conflicted merge leaves the operation state the panel renders', async () => {
    const repo = makeConflictingRepo();
    const res = await post({ actionType: 'merge_branch', repo: '.', root: repo, branch: 'feature' });
    // A conflict is the RESULT the panel exists to show, not a failure: git
    // exits 1 while `MERGE_HEAD` is live on disk, and reporting that as an error
    // put "failed" on screen beside the conflict it had just created. The STATE
    // is what matters, and the panel reads it from the status payload.
    expect(res.body.success).toBe(true);
    const state = await readGitState(repo);
    expect(state.operation).toBe('merge');
    expect(state.conflicts).toEqual(['f.txt']);
  });

  test('a name that is not a branch is refused before it reaches git', async () => {
    const repo = makeConflictingRepo();
    // `git merge --abort` would run happily on a bare `merge`, which is the
    // argv hole the check-ref-format guard closes.
    const res = await post({ actionType: 'merge_branch', repo: '.', root: repo, branch: '--abort' });
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('not a valid branch name');
    // Nothing happened: the repository is still on its own commit.
    expect(git(repo, 'log', '-1', '--pretty=%s')).toBe('main');
  });
});

describe('resolve_conflict', () => {
  test('taking a side writes that stage and clears the unmerged entry', async () => {
    const repo = makeConflictingRepo();
    await post({ actionType: 'merge_branch', repo: '.', root: repo, branch: 'feature' });

    const res = await post({ actionType: 'resolve_conflict', repo: '.', root: repo, file: 'f.txt', side: 'theirs' });
    expect(res.body.success).toBe(true);
    expect(fs.readFileSync(path.join(repo, 'f.txt'), 'utf8')).toBe('a\nFEAT\n');
    // Staged means the unmerged entries are gone, which is what "resolved" is.
    // (`ours` would be a no-op on the index here — it equals HEAD's content —
    // so the differing side is the one that proves the staging happened.)
    expect(git(repo, 'ls-files', '-u')).toBe('');
    expect(git(repo, 'diff', '--cached', '--name-only')).toBe('f.txt');
  });

  test('mark resolved only stages — the working tree is left alone', async () => {
    const repo = makeConflictingRepo();
    await post({ actionType: 'merge_branch', repo: '.', root: repo, branch: 'feature' });
    // Resolve by hand, as the editor would leave it.
    fs.writeFileSync(path.join(repo, 'f.txt'), 'a\nRESOLVED\n');

    const res = await post({ actionType: 'resolve_conflict', repo: '.', root: repo, file: 'f.txt' });
    expect(res.body.success).toBe(true);
    expect(fs.readFileSync(path.join(repo, 'f.txt'), 'utf8')).toBe('a\nRESOLVED\n');
    expect(git(repo, 'ls-files', '-u')).toBe('');
  });
});

describe('continue_operation', () => {
  test('concludes a resolved merge and clears the operation state', async () => {
    const repo = makeConflictingRepo();
    await post({ actionType: 'merge_branch', repo: '.', root: repo, branch: 'feature' });
    await post({ actionType: 'resolve_conflict', repo: '.', root: repo, file: 'f.txt', side: 'ours' });

    const res = await post({ actionType: 'continue_operation', repo: '.', root: repo });
    expect(res.body.success).toBe(true);
    expect((await readGitState(repo)).operation).toBeNull();
    expect(git(repo, 'log', '-1', '--pretty=%s')).toBe("Merge branch 'feature'");
  });

  /**
   * The verb is PER OPERATION.
   *
   * Measured: `git commit --no-edit` on a resolved REBASE conflict makes the
   * commit and leaves the rebase RUNNING (`rebase-merge` still present, status
   * reading "interactive rebase in progress"), so the operation bar would never
   * clear. Only `git rebase --continue` finishes the sequencer — same for
   * cherry-pick and revert.
   */
  test('concludes a REBASE, which `commit --no-edit` cannot', async () => {
    const repo = makeConflictingRepo();
    git(repo, 'rebase', 'feature');
    expect((await readGitState(repo)).operation).toBe('rebase');
    await post({ actionType: 'resolve_conflict', repo: '.', root: repo, file: 'f.txt', side: 'theirs' });

    const res = await post({ actionType: 'continue_operation', repo: '.', root: repo });
    expect(res.body.success).toBe(true);
    // The whole point: the rebase is GONE, not merely committed into.
    expect((await readGitState(repo)).operation).toBeNull();
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  test('concludes a CHERRY-PICK through its own --continue', async () => {
    const repo = makeConflictingRepo();
    git(repo, 'cherry-pick', 'feature');
    expect((await readGitState(repo)).operation).toBe('cherry-pick');
    await post({ actionType: 'resolve_conflict', repo: '.', root: repo, file: 'f.txt', side: 'theirs' });

    const res = await post({ actionType: 'continue_operation', repo: '.', root: repo });
    expect(res.body.success).toBe(true);
    expect((await readGitState(repo)).operation).toBeNull();
  });

  test('concludes a REVERT through its own --continue', async () => {
    const repo = makeConflictingRepo();
    // Revert the OTHER branch's commit from here — a revert conflict.
    git(repo, 'checkout', '-q', 'feature');
    git(repo, 'revert', '--no-edit', 'main');
    expect((await readGitState(repo)).operation).toBe('revert');
    // `theirs` is the side that actually changes the file here; `ours` would
    // resolve to the content already on disk and git would then refuse the
    // empty commit.
    await post({ actionType: 'resolve_conflict', repo: '.', root: repo, file: 'f.txt', side: 'theirs' });

    const res = await post({ actionType: 'continue_operation', repo: '.', root: repo });
    expect(res.body.success).toBe(true);
    expect((await readGitState(repo)).operation).toBeNull();
  });

  test('refuses a STASH POP that still has conflicts, and says nothing to conclude once resolved', async () => {
    const repo = makeConflictingRepo();
    fs.writeFileSync(path.join(repo, 'f.txt'), 'a\nSTASHED\n');
    git(repo, 'stash', 'push', '-q');
    fs.writeFileSync(path.join(repo, 'f.txt'), 'a\nHEAD\n');
    git(repo, 'commit', '-qam', 'moved-on');
    git(repo, 'stash', 'pop');

    // Still conflicted: the stash-pop answer takes precedence over the generic
    // conflict count, because "resolve your conflicts" is the wrong instruction
    // for a state with no sequencer to conclude.
    const conflicted = await post({ actionType: 'continue_operation', repo: '.', root: repo });
    expect(conflicted.body.success).toBe(false);
    expect(conflicted.body.error).toContain('Nothing to conclude');

    // Resolved: the changes are simply in the working tree, and there is still
    // nothing to continue — a `commit` here would create one the user never asked
    // for. (`git add` clears the unmerged entries, so the state reads `null`.)
    await post({ actionType: 'resolve_conflict', repo: '.', root: repo, file: 'f.txt', side: 'theirs' });
    const resolved = await post({ actionType: 'continue_operation', repo: '.', root: repo });
    expect(resolved.body.success).toBe(false);
    expect((await readGitState(repo)).operation).toBeNull();
  });

  test('refuses while a conflict remains, naming how many', async () => {
    const repo = makeConflictingRepo();
    await post({ actionType: 'merge_branch', repo: '.', root: repo, branch: 'feature' });

    const res = await post({ actionType: 'continue_operation', repo: '.', root: repo });
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('1 conflicted file');
    // Still mid-merge.
    expect((await readGitState(repo)).operation).toBe('merge');
  });
});

describe('abort_operation', () => {
  test('restores the pre-merge state', async () => {
    const repo = makeConflictingRepo();
    await post({ actionType: 'merge_branch', repo: '.', root: repo, branch: 'feature' });

    const res = await post({ actionType: 'abort_operation', repo: '.', root: repo });
    expect(res.body.success).toBe(true);
    expect((await readGitState(repo)).operation).toBeNull();
    expect(fs.readFileSync(path.join(repo, 'f.txt'), 'utf8')).toBe('a\nMAIN\n');
    expect(git(repo, 'status', '--porcelain')).toBe('');
  });

  test('refuses when nothing is in progress', async () => {
    const repo = makeConflictingRepo();
    const res = await post({ actionType: 'abort_operation', repo: '.', root: repo });
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('No merge, rebase, cherry-pick or revert');
  });

  test('clears a conflicting stash pop, which has no abort verb of its own', async () => {
    const repo = makeConflictingRepo();
    fs.writeFileSync(path.join(repo, 'f.txt'), 'a\nSTASHED\n');
    git(repo, 'stash', 'push', '-q');
    fs.writeFileSync(path.join(repo, 'f.txt'), 'a\nHEAD\n');
    git(repo, 'commit', '-qam', 'moved-on');
    git(repo, 'stash', 'pop');

    expect((await readGitState(repo)).operation).toBe('stash-pop');
    const res = await post({ actionType: 'abort_operation', repo: '.', root: repo });
    expect(res.body.success).toBe(true);
    expect(git(repo, 'status', '--porcelain')).toBe('');
    // The stash entry survives, which is what makes the retry possible.
    expect(git(repo, 'stash', 'list')).toContain('stash@{0}');
  });
});

describe('revert refuses a conflicted path', () => {
  test('discard on a conflicted file is refused rather than resolving it', async () => {
    const repo = makeConflictingRepo();
    await post({ actionType: 'merge_branch', repo: '.', root: repo, branch: 'feature' });
    const before = fs.readFileSync(path.join(repo, 'f.txt'), 'utf8');

    const res = await post({ actionType: 'revert', repo: '.', root: repo, file: 'f.txt' });
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('conflicted');
    // The conflict is intact and the merge is still open — the previous
    // behaviour threw the conflict away and left MERGE_HEAD in place.
    expect(fs.readFileSync(path.join(repo, 'f.txt'), 'utf8')).toBe(before);
    expect((await readGitState(repo)).operation).toBe('merge');
  });
});

describe('hash guards', () => {
  test('a non-hash is refused for every hash-taking action', async () => {
    const repo = makeConflictingRepo();
    for (const actionType of ['merge_commit', 'cherry_pick', 'revert_commit', 'rebase_commit']) {
      const res = await post({ actionType, repo: '.', root: repo, hash: '--abort' });
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('not a commit hash');
    }
  });

  test('an unknown reset mode is refused', async () => {
    const repo = makeConflictingRepo();
    const sha = git(repo, 'rev-parse', 'HEAD');
    const res = await post({ actionType: 'reset_commit', repo: '.', root: repo, hash: sha, mode: '--hard' });
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('Unknown reset mode');
  });
});
