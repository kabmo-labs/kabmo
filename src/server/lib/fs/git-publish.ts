/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
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
 *  - `git pull --ff-only` exits 1 with "There is no tracking information for the
 *    current branch" for the same branch — a refusal, not a failure of the
 *    user's intent: there is nothing to pull yet. Treating it as an error
 *    aborted Sync before it reached the push.
 *
 * The remote is read from the repository rather than assumed: `origin` is the
 * convention, not a guarantee.
 */

import { runGit, type GitRunResult } from '@/server/lib/fs/git-run';

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
 * Pull with fast-forward only, standing down on a branch with no upstream.
 *
 * Nothing to pull is not an error, and aborting here is what stopped Sync from
 * ever publishing a fresh branch.
 */
export async function pullBranch(cwd: string): Promise<void> {
  if (!(await readUpstream(cwd))) return;
  await expectOk(['pull', '--ff-only'], cwd, 120000);
}
