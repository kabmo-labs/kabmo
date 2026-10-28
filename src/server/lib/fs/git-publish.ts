/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Publishing one branch: push, and the pull that precedes it.
 *
 * Both exist because the naive commands fail on the branch a user is most
 * likely to be on — one just created locally.
 *
 *  - `git push` exits 128 with "The current branch <name> has no upstream
 *    branch" when the branch was never published, so Sync failed outright on
 *    exactly the branch whose commits it was supposed to send. `push -u <remote>
 *    HEAD` sets the upstream while it publishes.
 *  - `git pull` exits 1 with "There is no tracking information for the
 *    current branch" for the same branch — a refusal, not a failure of the
 *    user's intent: there is nothing to pull yet. Treating it as an error
 *    aborted Sync before it reached the push.
 *
 * The remote is read from the repository rather than assumed: `origin` is the
 * convention, not a guarantee.
 */

import { runGit, type GitRunResult } from '@/server/lib/fs/git-run';
import { readGitState } from '@/server/lib/fs/git-state';

/** Runs a git command and throws with its stderr when it exits non-zero. */
async function expectOk(args: string[], cwd: string, timeout?: number): Promise<GitRunResult> {
  const result = await runGit(args, { cwd, timeout, maxBuffer: 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `git exited with code ${result.exitCode}`);
  }
  return result;
}

/** The branch's upstream (`origin/main`), or null when it has none. */
async function readUpstream(cwd: string): Promise<string | null> {
  const result = await runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { cwd });
  if (result.exitCode !== 0) return null;
  return result.stdout.trim() || null;
}

/**
 * Push the current branch, PUBLISHING it when it has no upstream.
 *
 * A branch that already tracks somewhere pushes to its own remote; `-u <remote>
 * HEAD` would re-point it. A branch with no upstream is published to the
 * repository's first remote.
 */
export async function pushBranch(cwd: string): Promise<void> {
  const upstream = await readUpstream(cwd);
  if (upstream) {
    await expectOk(['push'], cwd, 120000);
    return;
  }

  const remotes = await runGit(['remote'], { cwd });
  const remote = remotes.stdout.split('\n').map((line) => line.trim()).filter(Boolean)[0];
  if (!remote) throw new Error('This repository has no remote to push to.');
  await expectOk(['push', '-u', remote, 'HEAD'], cwd, 120000);
}

/**
 * Pull the branch's upstream, standing down on a branch with no upstream.
 *
 * Nothing to pull is not an error, and aborting here is what stopped Sync from
 * ever publishing a fresh branch.
 *
 * **`--ff-only` was wrong, and it is the reported "Sync does nothing when I
 * have one local commit and one on origin".** On a DIVERGED branch git refuses
 * it outright — measured: `fatal: Not possible to fast-forward, aborting.`
 * (exit 128) — so Sync threw before it reached the push, the badge stayed at
 * `↑1 ↓1`, and the panel reported git's advice text as an error. The two
 * branches cannot be reconciled by moving a pointer; they need a merge commit,
 * which is what `git pull` does by default. `--ff --no-rebase` states that
 * explicitly instead of inheriting the user's `pull.rebase`/`pull.ff`: both
 * were measured to change the answer (`pull.ff=only` reproduces the refusal,
 * `pull.rebase=true` rewrites local commits), and a Sync button must not mean
 * two different things per repository. A fast-forward still happens where one
 * is possible — verified against a behind-only branch.
 *
 * **A merge that stops on a conflict is SUCCESS, not a failure.** Measured:
 * the command exits 1 with `MERGE_HEAD` in place and `UU` rows in the status —
 * the state the panel's operation bar exists to show. Throwing there reported
 * the conflict as a failed sync and hid the bar's own instructions, so the
 * caller checks for a started merge exactly as `expectStarted` does for a
 * merge the user asked for.
 */
export async function pullBranch(cwd: string): Promise<void> {
  if (!(await readUpstream(cwd))) return;
  const result = await runGit(['pull', '--ff', '--no-rebase', '--no-edit'], {
    cwd,
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.exitCode === 0) return;
  const state = await readGitState(cwd);
  if (state.operation === 'merge') return;
  throw new Error(
    result.stderr.trim() || result.stdout.trim() || `git exited with code ${result.exitCode}`,
  );
}
