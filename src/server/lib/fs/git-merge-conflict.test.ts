/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A merge, rebase, cherry-pick or stash pop that STOPS ON A CONFLICT is a
 * RESULT, not a failure.
 *
 * This is the bug the e2e layer could not see and a unit test can: `git merge`
 * exits 1 when it leaves conflicts, and the route treated any non-zero exit as
 * an error, so it answered 400 while `MERGE_HEAD` was live on disk. The panel
 * then showed a failed request beside the conflict it had just created — and
 * because the spec helper ignored the response, the e2e run read as a flaky
 * panel rather than a rejected command (measured: 5 of 10 git-panel specs
 * failed in CI on every run, all green locally only because a local git
 * identity let the merge commit cleanly).
 *
 * The proof that a stop is genuine is the OPERATION the command left behind:
 * a real failure (a bad ref, a dirty tree) leaves none.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mergeBranch, rebaseOnto } from '@/server/lib/fs/git-merge';
import { applyStash, pushStash } from '@/server/lib/fs/git-stash';
import { readGitState } from '@/server/lib/fs/git-state';

const repos: string[] = [];

afterEach(() => {
  while (repos.length > 0) fs.rmSync(repos.pop() as string, { recursive: true, force: true });
});

/** A scratch repo with an identity that cannot leak into the developer's config. */
function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ompchamber-merge-'));
  repos.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  return dir;
}

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync({
    cmd: ['git', ...args],
    cwd,
    // Identity through the ENVIRONMENT, not `-c`: the CI runner has no global
    // git identity, and a commit made by a fixture must not depend on one.
    env: {
      ...Bun.env,
      GIT_EDITOR: 'true',
      GIT_AUTHOR_NAME: 'E2E',
      GIT_AUTHOR_EMAIL: 'e2e@example.invalid',
      GIT_COMMITTER_NAME: 'E2E',
      GIT_COMMITTER_EMAIL: 'e2e@example.invalid',
    },
  });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString()}`);
  return result.stdout.toString();
}

/** Two branches editing the same line, so a merge stops on a conflict. */
function seedConflict(cwd: string, file = 'shared.txt'): void {
  fs.writeFileSync(path.join(cwd, file), 'one\ntwo\nthree\n');
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '-m', 'base');
  git(cwd, 'checkout', '-q', '-b', 'feature');
  fs.writeFileSync(path.join(cwd, file), 'one\nFEATURE\nthree\n');
  git(cwd, 'commit', '-q', '-am', 'feature');
  git(cwd, 'checkout', '-q', 'main');
  fs.writeFileSync(path.join(cwd, file), 'one\nMAIN\nthree\n');
  git(cwd, 'commit', '-q', '-am', 'main');
}

describe('a conflicting merge is accepted, not reported as a failure', () => {
  test('mergeBranch resolves with MERGE_HEAD in place', async () => {
    const repo = makeRepo();
    seedConflict(repo);
    // Would throw before the fix: git exits 1 on a conflict.
    await mergeBranch(repo, 'feature');
    expect((await readGitState(repo)).operation).toBe('merge');
    expect(fs.existsSync(path.join(repo, '.git', 'MERGE_HEAD'))).toBe(true);
  });

  test('a merge that genuinely fails still throws', async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 'a.txt'), 'x\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'only commit');
    // No such branch, and no operation is left behind — the error stands.
    await expect(mergeBranch(repo, 'does-not-exist')).rejects.toThrow();
    expect((await readGitState(repo)).operation).toBeNull();
  });
});

describe('a conflicting rebase is accepted', () => {
  test('rebaseOnto resolves with a rebase in progress', async () => {
    const repo = makeRepo();
    seedConflict(repo);
    // `rebaseOnto` takes a HASH (the panel's own caller sends one), so resolve
    // the feature tip first. main and feature both touched the same line.
    const featureTip = git(repo, 'rev-parse', 'feature').trim();
    await rebaseOnto(repo, featureTip);
    expect((await readGitState(repo)).operation).toBe('rebase');
  });
});

describe('a conflicting stash pop is accepted', () => {
  test('applyStash resolves with the stash-pop state', async () => {
    const repo = makeRepo();
    fs.writeFileSync(path.join(repo, 's.txt'), 'one\ntwo\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'base');
    fs.writeFileSync(path.join(repo, 's.txt'), 'one\nSTASHED\n');
    await pushStash({ targetDir: repo, message: 'wip' });
    // A different change to the same line, committed, so the pop conflicts.
    fs.writeFileSync(path.join(repo, 's.txt'), 'one\nCOMMITTED\n');
    git(repo, 'commit', '-q', '-am', 'move on');
    await applyStash({ targetDir: repo, ref: 'stash@{0}', pop: true });
    expect((await readGitState(repo)).operation).toBe('stash-pop');
  });
});
