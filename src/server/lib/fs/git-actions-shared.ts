/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The pieces every Source Control action handler shares: the git runner
 * wrapper, the two client-string guards, and the handler's own types.
 *
 * Split out so the action tables (`git-actions-worktree.ts`,
 * `git-actions-branch.ts`) do not each carry a copy of the guards. The guards
 * are the point: a handler's operands come from a request body, and every one
 * of them is either validated against git itself (`check-ref-format`, a hash
 * shape) or separated with `--` before it reaches argv.
 */

import { repoRelative, resolveRepoPath, runGit } from '@/server/lib/fs/git-run';
import { readGitState } from '@/server/lib/fs/git-state';
import type { GitOperation } from '@/shared/types';

export interface GitActionContext {
  formData: FormData;
  /** The working tree the action runs in, already resolved and contained. */
  targetDir: string;
}

/**
 * A handler's answer. `undefined` means "success, nothing to report"; an object
 * is the JSON body the route returns (the history/graph reads carry a page).
 */
export type GitActionHandler = (ctx: GitActionContext) => Promise<unknown>;

/** Runs a git command and throws with its stderr when it exits non-zero. */
export async function expectOk(args: string[], cwd: string, timeout?: number): Promise<void> {
  const result = await runGit(args, { cwd, timeout, maxBuffer: 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `git exited with code ${result.exitCode}`);
  }
}

/** True when the ref resolves; `--quiet` keeps stderr clean on a miss. */
export async function refExists(ref: string, cwd: string): Promise<boolean> {
  const result = await runGit(['rev-parse', '--verify', '--quiet', ref], { cwd });
  return result.exitCode === 0;
}

/**
 * The repo-relative path a single-file action names, refused when it escapes
 * the working tree.
 *
 * `resolveRepoPath` is what makes the guard real: the untracked branch of a
 * discard REMOVES the path, so a client-supplied `../../x` must not become a
 * filesystem target. Git itself bounds a pathspec, but the removal does not go
 * through git.
 */
export function fileForAction(formData: FormData, targetDir: string): string {
  const raw = (formData.get('file') as string) ?? '';
  const relative = repoRelative(raw);
  if (!resolveRepoPath(targetDir, relative)) {
    throw new Error(`Invalid path: ${raw}`);
  }
  return relative;
}

/**
 * A hash operand, refused unless it is shaped like one.
 *
 * Measured: without this, `git merge <hash>` ran `git merge --abort` when the
 * "hash" was the string `--abort`, and `reset --soft --help` printed its usage
 * instead of resetting. The shape is the only thing that distinguishes a commit
 * from an option here.
 */
export function hashFor(formData: FormData): string {
  const hash = ((formData.get('hash') as string) ?? '').trim();
  if (!/^[0-9a-f]{7,40}$/i.test(hash)) throw new Error(`'${hash}' is not a commit hash.`);
  return hash;
}

/** A trimmed text field; `''` when absent. */
export function field(formData: FormData, name: string): string {
  return ((formData.get(name) as string) ?? '').trim();
}

/** A `'1'`/absent checkbox. */
export function flag(formData: FormData, name: string): boolean {
  return formData.get(name) === '1';
}

/**
 * The answer an action that can START an operation returns: whether one is now
 * stopped on a conflict.
 *
 * `git merge`, `cherry-pick`, `revert`, `rebase` and `git pull` exit zero (or
 * with the conflict left behind) and leave the tree in a state the operation bar
 * owns — so the action SUCCEEDED, but what it did is not what its verb promised.
 * The panel says so in its toast, which is why the name travels back: "Merged
 * feature" over a merge that stopped on a conflict claims an outcome git never
 * produced. A conflicting `git stash pop` reports `stash-pop` here too, from the
 * conflicts it leaves with no operation file at all.
 *
 * `undefined` — the handler's "success, nothing to report" — when the tree is
 * clean afterwards, so an ordinary merge answers exactly what it used to.
 */
export async function stoppedOperationPayload(
  targetDir: string,
): Promise<{ success: true; stopped: GitOperation } | undefined> {
  const state = await readGitState(targetDir);
  return state.operation ? { success: true, stopped: state.operation } : undefined;
}
