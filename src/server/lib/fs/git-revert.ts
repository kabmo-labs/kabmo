/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Restore one path to its committed state, discarding local changes — and
 * REFUSE to do it to a conflicted one.
 *
 * Three git steps, because a single command cannot cover the states a change
 * can be in:
 *
 *  1. `git reset -q -- <path>` unstages it. `git restore --staged` is the
 *     obvious form but it resolves HEAD and refuses outright in a repository
 *     whose first commit is still staged ("could not resolve 'HEAD'"), so a
 *     discard there left the file staged and reported success (verified).
 *  2. `git checkout -- <path>` restores a tracked change. It works with an
 *     unborn HEAD and it never touches an untracked path (it exits non-zero,
 *     which is not a failure here).
 *  3. `git clean -fd -- <path>` removes what step 2 left: an untracked file, or
 *     a file that was only ever staged.
 *
 * The previous shape (`git restore`, and on ANY failure `fs.rmSync` the path)
 * is why a discard could destroy committed work: for a folder holding a clean
 * tracked file beside an untracked one, `git status --porcelain -- <dir>` opens
 * with `??` — that branch took `rm -rf` and deleted the tracked file too
 * (verified: the committed `dir/keep.txt` was gone and the tree read ` D`). It
 * also deleted a modified TRACKED file whenever the restore failed for an
 * unrelated reason, such as a filename holding a double quote.
 *
 * **The conflict refusal is the fourth rule, and it is the one that matters
 * most.** On a conflicted path the three steps above succeed while doing
 * something the user did not ask for: measured on a real `UU f`, the sequence
 * threw away the conflicted content, restored the pre-merge version of that
 * file, and LEFT `MERGE_HEAD` in place — `git status` afterwards read "All
 * conflicts fixed but you are still merging". A trash icon that silently ends
 * a conflict by picking one side, and leaves the operation open, is worse than
 * no trash icon: the merge looks finished and is not. Resolving a conflict is
 * a decision (`--ours`/`--theirs`/edit), so it has its own actions.
 */

import { runGit } from '@/server/lib/fs/git-run';

/** Runs a git command and throws with its stderr when it exits non-zero. */
async function expectOk(args: string[], cwd: string, timeout?: number): Promise<void> {
  const result = await runGit(args, { cwd, timeout, maxBuffer: 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `git exited with code ${result.exitCode}`);
  }
}

export interface RevertOptions {
  targetDir: string;
  /** Repo-relative path. */
  file: string;
  /** Paths with unmerged index entries, from `readGitState`. */
  conflicts: readonly string[];
}

/**
 * Discard local changes to one path.
 *
 * Throws on a conflicted path rather than resolving it: the caller has the
 * conflict list (it read the state to render the row), so this is a guard
 * against the wrong action being offered, not a second read.
 */
export async function revertPath({ targetDir, file, conflicts }: RevertOptions): Promise<void> {
  if (conflicts.includes(file)) {
    throw new Error(
      `${file} is conflicted — take one side or resolve it in the editor instead of discarding.`,
    );
  }

  await expectOk(['reset', '-q', '--', file], targetDir);

  const restored = await runGit(['checkout', '--', file], { cwd: targetDir });
  // A path git does not know (untracked, or already gone) is not a failure —
  // the clean below is what removes it.
  if (!restored.error && restored.exitCode !== 0 && !/pathspec/i.test(restored.stderr)) {
    throw new Error(restored.stderr.trim() || `git checkout exited with code ${restored.exitCode}`);
  }

  await expectOk(['clean', '-fd', '--', file], targetDir);
}

/** Discard every unstaged change in the working tree. */
export async function revertAll(targetDir: string): Promise<void> {
  // `checkout` covers tracked changes in a repository with no commits too, and
  // it never deletes an untracked file — `clean` does that explicitly.
  await expectOk(['checkout', '--', '.'], targetDir);
  await expectOk(['clean', '-fd'], targetDir);
}
