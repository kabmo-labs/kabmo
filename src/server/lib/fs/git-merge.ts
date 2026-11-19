/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Merge, and the three actions that exist only while an operation is stopped on
 * a conflict: abort, continue, and resolving one path.
 *
 * **A merge is merged BY NAME, not by SHA.** `git merge <sha>` writes
 * `Merge commit '<sha>'`; `git merge <branch>` writes `Merge branch '<name>'`.
 * The panel's only merge today goes through the commit modal and sends a full
 * hash, so every merge it ever made produced the worse message — measured on a
 * scratch repo, both forms.
 *
 * **Continue is `git commit --no-edit`, not `git merge --continue`.** Both
 * conclude a resolved merge (verified: `MERGE_HEAD` is gone after either), but
 * `--continue` needs an editor for the message git prepared and there is no
 * terminal to draw one in. Two failure modes were reproduced: with `GIT_EDITOR`
 * unset it exits with `error: Terminal is dumb, but EDITOR unset`; with a real
 * `GIT_EDITOR=vim` inherited it BLOCKS on vim until the timeout kills it.
 * `git commit --no-edit` needs no editor at all, which is why it is the verb —
 * `runGit` sets `GIT_EDITOR=true` as the belt to this braces.
 *
 * **`--ours`/`--theirs` are INVERTED during a rebase.** Measured on the same
 * two commits: in a merge conflict `--ours` yields the branch you are on and
 * `--theirs` the branch merged in; in a rebase conflict `--ours` yields the
 * branch being rebased ONTO and `--theirs` your own commit. The caller must
 * label the buttons from the conflict markers (`parseConflictMarkers`), not
 * from the words ours/theirs — a button that says "ours" and silently takes the
 * other side in half the states is worse than no button.
 */

import { runGit } from '@/server/lib/fs/git-run';
import { readGitState } from '@/server/lib/fs/git-state';
import type { GitOperation } from '@/shared/types';

/** Runs a git command and throws with its stderr when it exits non-zero. */
async function expectOk(args: string[], cwd: string, timeout?: number): Promise<string> {
  const result = await runGit(args, { cwd, timeout, maxBuffer: 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `git exited with code ${result.exitCode}`);
  }
  return result.stdout;
}

/**
 * Run a command that STARTS an operation, and accept a conflict stop as success.
 *
 * `git merge`, `rebase`, `cherry-pick` and `revert` exit **1** when they stop on
 * a conflict — that is the state the panel exists to show, not a failure. The
 * bare `expectOk` reported it as an error, so the route answered 400 while the
 * operation was in fact live on disk: the panel's own request said "failed"
 * beside a conflict it had just created. Verified against a real conflicting
 * merge: `git merge --no-edit -- feature` exits 1, `MERGE_HEAD` exists, and the
 * old path surfaced `Auto-merging shared.txt / CONFLICT (content) …` as the
 * error message.
 *
 * A non-zero exit is therefore only an error when NO operation was left behind
 * (a bad branch name, a dirty tree, a missing ref). The operation name is passed
 * in because the caller knows which one it started.
 */
async function expectStarted(args: string[], cwd: string, operation: GitOperation, timeout: number): Promise<string> {
  const result = await runGit(args, { cwd, timeout, maxBuffer: 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.exitCode === 0) return result.stdout;
  const state = await readGitState(cwd);
  if (state.operation === operation) return result.stdout;
  throw new Error(result.stderr.trim() || result.stdout.trim() || `git exited with code ${result.exitCode}`);
}

/**
 * Merge a branch into the current one.
 *
 * `--no-edit` accepts git's own merge message, which is the one the user would
 * have kept: a plain `git merge` in this environment has no editor to open, and
 * the merge message is not something the panel collects. No `--no-ff` — a
 * fast-forward is what the user asked for by merging a branch that is ahead.
 *
 * The name is validated first, so a string that is not a branch cannot reach
 * git as an option (`git merge --abort` would run happily on a bare `merge`).
 */
export async function mergeBranch(targetDir: string, branch: string): Promise<string> {
  const name = branch.trim();
  if (!name) throw new Error('A branch name is required.');
  const check = await runGit(['check-ref-format', '--branch', name], { cwd: targetDir, timeout: 5_000 });
  if (check.exitCode !== 0) {
    throw new Error(check.stderr.trim() || `'${name}' is not a valid branch name`);
  }
  await expectStarted(['merge', '--no-edit', '--', name], targetDir, 'merge', 120_000);
  return `git merge ${name}`;
}

/** True when a ref resolves — used to refuse a merge of something that is not one. */
export async function refResolves(targetDir: string, ref: string): Promise<boolean> {
  const result = await runGit(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: targetDir, timeout: 5_000 });
  return result.exitCode === 0;
}

/**
 * Merge one commit by hash — the commit modal's action.
 *
 * Kept separate from `mergeBranch` because the two produce different history
 * (a hash cannot name a branch in the merge message) and because the hash path
 * is reached from a commit row where there is no branch name to send. The
 * `--` separator and the hash-shape guard close the argv hole the previous
 * `['merge', hash]` had: measured, `git merge --abort` ran when the "hash" was
 * `--abort`.
 */
export async function mergeCommit(targetDir: string, hash: string): Promise<void> {
  const sha = hash.trim();
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) throw new Error(`'${sha}' is not a commit hash.`);
  await expectStarted(['merge', '--no-edit', '--', sha], targetDir, 'merge', 120_000);
}

/** Cherry-pick one commit, with the same guard. */
export async function cherryPick(targetDir: string, hash: string): Promise<void> {
  const sha = hash.trim();
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) throw new Error(`'${sha}' is not a commit hash.`);
  await expectStarted(['cherry-pick', '--', sha], targetDir, 'cherry-pick', 120_000);
}

/** Revert one commit without opening an editor for the message. */
export async function revertCommit(targetDir: string, hash: string): Promise<void> {
  const sha = hash.trim();
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) throw new Error(`'${sha}' is not a commit hash.`);
  await expectStarted(['revert', '--no-edit', '--', sha], targetDir, 'revert', 120_000);
}

/** Rebase onto a commit, with the same guard. */
export async function rebaseOnto(targetDir: string, hash: string): Promise<void> {
  const sha = hash.trim();
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) throw new Error(`'${sha}' is not a commit hash.`);
  await expectStarted(['rebase', '--', sha], targetDir, 'rebase', 120_000);
}

/** Reset the current branch, with the mode and the hash both guarded. */
export async function resetTo(targetDir: string, hash: string, mode: string): Promise<void> {
  const sha = hash.trim();
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) throw new Error(`'${sha}' is not a commit hash.`);
  if (!['soft', 'mixed', 'hard'].includes(mode)) throw new Error(`Unknown reset mode: ${mode}`);
  await expectOk(['reset', `--${mode}`, '--', sha], targetDir, 30_000);
}

/**
 * Conclude an operation whose conflicts are all resolved.
 *
 * **The verb is PER OPERATION, and `git commit --no-edit` is only right for a
 * merge.** Measured on a real rebase conflict: resolving the file and running
 * `git commit --no-edit` makes the commit but leaves the rebase RUNNING —
 * `rebase-merge` is still there, `git status` reads "interactive rebase in
 * progress … use `git rebase --continue`", and the operation bar would never
 * clear. The same applies to cherry-pick and revert, each of which has its own
 * `--continue` that finishes the sequencer.
 *
 * `stash-pop` is deliberately absent: a conflicting stash pop leaves the
 * resolved changes in the WORKING TREE with no operation to conclude — there is
 * nothing to continue, and the stash entry survives so it can be dropped
 * separately. `continueArgsFor` returns `null` for it, and the bar hides the
 * button rather than offering a verb that would do the wrong thing.
 *
 * `GIT_EDITOR=true` (set by `runGit`) is what makes the `--continue` forms
 * usable here: without it `rebase --continue` fails with "Terminal is dumb, but
 * EDITOR unset", and with a real editor inherited it blocks until the timeout.
 */
export function continueArgsFor(operation: GitOperation): string[] | null {
  switch (operation) {
    case 'merge':
      return ['commit', '--no-edit'];
    case 'rebase':
    case 'rebase-apply':
      return ['rebase', '--continue'];
    case 'cherry-pick':
      return ['cherry-pick', '--continue'];
    case 'revert':
      return ['revert', '--continue'];
    case 'stash-pop':
      // No operation to conclude: the applied changes are in the working tree.
      return null;
  }
}

/** Which side of a conflict to keep. */
export type ConflictSide = 'ours' | 'theirs';

export interface ResolveConflictOptions {
  targetDir: string;
  file: string;
  /** Omit for "mark resolved" — the file was edited by hand. */
  side?: ConflictSide;
}

/**
 * Resolve one conflicted path.
 *
 * `side` runs `git checkout --ours|--theirs -- <path>` (both verified: they
 * write the chosen stage into the working tree) and then `git add`, which is
 * what moves `ls-files -u` toward empty. No `side` is "mark resolved": the file
 * was resolved in the editor and only the `git add` is missing — exactly what
 * git's own hint tells the user to run.
 *
 * `--` separates the path in both commands: a repo-relative path is
 * repository-controlled data, and the same rule `revertPath` follows applies.
 */
export async function resolveConflict({ targetDir, file, side }: ResolveConflictOptions): Promise<void> {
  if (!file.trim()) throw new Error('A file path is required.');
  if (side) await expectOk(['checkout', `--${side}`, '--', file], targetDir, 30_000);
  await expectOk(['add', '--', file], targetDir, 30_000);
}
