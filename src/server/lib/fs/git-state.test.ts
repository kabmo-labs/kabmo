/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The operation-state read, driven against REAL repositories in every state it
 * reports.
 *
 * The state lives in FILES in the git directory, so the fixtures are the files
 * git itself writes: a merge stopped on a conflict (`MERGE_HEAD`), a rebase
 * (`rebase-merge`), a cherry-pick (`CHERRY_PICK_HEAD`), and — the case that
 * makes the read non-trivial — a conflicting `git stash pop`, which leaves
 * unmerged entries and NO operation file at all. That last one is why
 * `stash-pop` is a distinct operation rather than a null: every `--abort` verb
 * answers "no <op> in progress" there (verified), so the abort has to be
 * `git reset --merge HEAD`.
 *
 * A detached HEAD is pinned too, because the branch read reports the literal
 * string `HEAD` for it and that string used to reach the branch list as a
 * branch the user could check out.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { abortArgsFor, readGitState } from '@/server/lib/fs/git-state';
import { removeDir } from '@/test-support/remove-dir';

const roots: string[] = [];

/**
 * Run one git command, ignoring its exit code.
 *
 * The fixtures deliberately run commands that FAIL: a conflicting merge, a
 * rebase, a cherry-pick and a `stash pop` all exit non-zero by design. The
 * helper returns stdout/stderr either way and lets each test assert on the
 * STATE the failure left, which is the whole subject of this file.
 */
function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync({ cmd: ['git', ...args], cwd, env: { ...Bun.env, GIT_EDITOR: 'true' } });
  return result.stdout.toString().trim();
}

/** A repository on `main` and `feature` whose two branches edit the same line. */
function makeConflictingRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-gitstate-'));
  roots.push(dir);
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

afterAll(() => {
  for (const dir of roots) removeDir(dir);
});

describe('readGitState: no operation', () => {
  test('a clean repository reports no operation and no conflicts', async () => {
    const dir = makeConflictingRepo();
    const state = await readGitState(dir);
    expect(state.operation).toBeNull();
    expect(state.conflicts).toEqual([]);
    expect(state.detached).toBe(false);
  });

  test('a directory that is not a repository answers the empty state, not an error', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-notrepo-'));
    roots.push(dir);
    const state = await readGitState(dir);
    expect(state).toEqual({ operation: null, conflicts: [], detached: false });
  });
});

describe('readGitState: each operation', () => {
  test('a stopped merge reports MERGE_HEAD and its conflicted path', async () => {
    const dir = makeConflictingRepo();
    git(dir, 'merge', '--no-edit', 'feature');
    const state = await readGitState(dir);
    expect(state.operation).toBe('merge');
    expect(state.conflicts).toEqual(['f.txt']);
    // The abort verb is the one git accepts in this state.
    expect(abortArgsFor(state.operation!)).toEqual(['merge', '--abort']);
  });

  test('a stopped rebase reports rebase-merge and detaches HEAD', async () => {
    const dir = makeConflictingRepo();
    git(dir, 'rebase', 'feature');
    const state = await readGitState(dir);
    expect(state.operation).toBe('rebase');
    expect(state.conflicts).toEqual(['f.txt']);
    // A rebase detaches, which is the second reason the branch read needs this.
    expect(state.detached).toBe(true);
    expect(abortArgsFor(state.operation!)).toEqual(['rebase', '--abort']);
  });

  test('a stopped cherry-pick reports CHERRY_PICK_HEAD', async () => {
    const dir = makeConflictingRepo();
    git(dir, 'cherry-pick', 'feature');
    const state = await readGitState(dir);
    expect(state.operation).toBe('cherry-pick');
    expect(state.conflicts).toEqual(['f.txt']);
    expect(abortArgsFor(state.operation!)).toEqual(['cherry-pick', '--abort']);
  });

  test('a conflicting stash pop reports stash-pop, which has NO operation file', async () => {
    const dir = makeConflictingRepo();
    // Stash a change to the same line the incoming one touches, then pop it
    // onto a commit that has since changed that line.
    fs.writeFileSync(path.join(dir, 'f.txt'), 'a\nSTASHED\n');
    git(dir, 'stash', 'push', '-q');
    fs.writeFileSync(path.join(dir, 'f.txt'), 'a\nHEAD\n');
    git(dir, 'commit', '-qam', 'moved-on');
    git(dir, 'stash', 'pop');
    const state = await readGitState(dir);
    expect(state.operation).toBe('stash-pop');
    expect(state.conflicts).toEqual(['f.txt']);
    // No abort verb exists for it; the reset is the only thing that clears it.
    expect(abortArgsFor(state.operation!)).toEqual(['reset', '--merge', 'HEAD']);
  });
});

describe('readGitState: conflict list shape', () => {
  test('a path with a space survives the NUL-separated read', async () => {
    const dir = makeConflictingRepo();
    const name = 'a file with spaces.txt';
    fs.writeFileSync(path.join(dir, name), 'a\nb\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-qm', 'add spaced');
    git(dir, 'checkout', '-qb', 'spaced');
    fs.writeFileSync(path.join(dir, name), 'a\nSPACED\n');
    git(dir, 'commit', '-qam', 'spaced change');
    git(dir, 'checkout', '-q', 'main');
    fs.writeFileSync(path.join(dir, name), 'a\nMAIN2\n');
    git(dir, 'commit', '-qam', 'main change');
    git(dir, 'merge', '--no-edit', 'spaced');
    const state = await readGitState(dir);
    expect(state.conflicts).toEqual([name]);
  });

  test('a conflict list names each path ONCE despite three index stages', async () => {
    // `ls-files -u` prints a record per stage (1 base, 2 ours, 3 theirs), so a
    // list without the dedupe would repeat every path three times — and the
    // operation bar's "N conflicts left" count would read 3x the truth.
    const dir = makeConflictingRepo();
    git(dir, 'merge', '--no-edit', 'feature');
    const state = await readGitState(dir);
    expect(state.conflicts.length).toBe(1);
  });
});

describe('readGitState: detached HEAD', () => {
  test('a detached checkout is reported as detached', async () => {
    const dir = makeConflictingRepo();
    git(dir, 'checkout', '-q', '--detach', 'HEAD~1');
    const state = await readGitState(dir);
    expect(state.detached).toBe(true);
    expect(state.operation).toBeNull();
  });
});
