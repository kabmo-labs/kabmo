/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Branch listing, rename and delete — the reads and writes behind the branch
 * management modal.
 *
 * The listing extends the ONE `for-each-ref` the status read already makes
 * (three fields) with the metadata a branch row needs: its upstream, the
 * ahead/behind track, the last commit's relative date and subject. Measured on
 * 501 branches: 0.01s → 0.03s. One spawn, not one per branch.
 *
 * `%(upstream:track)` is the field that carries the state, and it was measured
 * in every form it takes: `[ahead 1]`, `[behind 3]`, `[ahead 1, behind 3]`,
 * `[gone]` (the upstream ref was deleted), and EMPTY for a branch with no
 * upstream — including a branch several commits ahead of everything, which is
 * why an empty track must render as "unpublished" and never as "in sync".
 *
 * `%(ahead-behind:HEAD)` is deliberately unused: it answers "ahead of the
 * CURRENT branch", not "ahead of the upstream" (measured: a branch two commits
 * ahead of `main` reads `[2 0]` while its upstream track is empty), which is a
 * different question from the one the row asks.
 */

import { runGit } from '@/server/lib/fs/git-run';

export interface BranchDetail {
  name: string;
  /** True for the checked-out branch. */
  current: boolean;
  /** The upstream's short name (`origin/main`), or `''` when there is none. */
  upstream: string;
  /**
   * Commits ahead of / behind the upstream. Both 0 with an empty `upstream`
   * means UNPUBLISHED, not in sync — the row must say so.
   */
  ahead: number;
  behind: number;
  /** The upstream ref no longer exists on the remote (`[gone]`). */
  gone: boolean;
  /** The branch tip's commit subject. */
  subject: string;
  /** The branch tip's relative commit date (`3 hours ago`). */
  date: string;
}

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
 * One branch row's worth of metadata for every local branch.
 *
 * `%(HEAD)` is `*` on the checked-out branch. `%(upstream:track,nobracket)`
 * strips the brackets git prints around the track, so the value is
 * `ahead 1, behind 2` / `gone` / empty and no parser has to peel punctuation.
 */
export async function listBranchDetails(targetDir: string): Promise<BranchDetail[]> {
  const format = [
    '%(refname:short)',
    '%(HEAD)',
    '%(upstream:short)',
    '%(upstream:track,nobracket)',
    '%(committerdate:relative)',
    '%(subject)',
  ].join('%09');
  const result = await runGit(
    ['for-each-ref', `--format=${format}`, '--sort=-committerdate', 'refs/heads'],
    { cwd: targetDir, timeout: 8_000 },
  );
  if (result.exitCode !== 0) return [];

  const branches: BranchDetail[] = [];
  for (const line of result.stdout.split('\n')) {
    if (!line.trim()) continue;
    const [name, head, upstream, track, date, ...subjectParts] = line.split('\t');
    if (!name) continue;
    const { ahead, behind } = parseTrack(track);
    branches.push({
      name,
      current: head === '*',
      upstream,
      ahead,
      behind,
      gone: track === 'gone',
      date,
      subject: subjectParts.join('\t'),
    });
  }
  return branches;
}

/**
 * `ahead 1, behind 2` → `{ahead: 1, behind: 2}`; anything else → zeros.
 *
 * `gone` and an empty track both yield zeros — the caller distinguishes them by
 * `upstream`/`gone`, and inventing a count for either would be the lie the
 * branch row exists to avoid.
 */
function parseTrack(track: string): { ahead: number; behind: number } {
  let ahead = 0;
  let behind = 0;
  const aheadMatch = /ahead (\d+)/.exec(track);
  if (aheadMatch) ahead = Number(aheadMatch[1]) || 0;
  const behindMatch = /behind (\d+)/.exec(track);
  if (behindMatch) behind = Number(behindMatch[1]) || 0;
  return { ahead, behind };
}

/**
 * Refuse a branch name git itself would refuse.
 *
 * `git check-ref-format --branch` is the authority, and it is what makes a name
 * like `--abort` impossible: measured, it rejects a leading `-`
 * (`'-dash' is not a valid branch name`) as well as a space. The route is a
 * client's only gate, so the check runs server-side even when the dialog
 * already validated.
 */
export async function assertValidBranchName(targetDir: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('A branch name is required.');
  const result = await runGit(['check-ref-format', '--branch', trimmed], { cwd: targetDir, timeout: 5_000 });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || `'${trimmed}' is not a valid branch name`);
  }
}

export interface RenameBranchOptions {
  targetDir: string;
  /** The branch to rename, as it is named now. */
  from: string;
  /** The new name. */
  to: string;
  /** Also rename it on the remote (push the new name, delete the old one). */
  remote: boolean;
}

/**
 * Rename a branch, locally and optionally on the remote.
 *
 * **`git branch -m` does NOT move the upstream.** Measured: after
 * `git branch -m main trunk`, the branch's config still reads
 * `branch.trunk.merge = refs/heads/main`, and a plain `git push` then refuses
 * outright — `fatal: The upstream branch of your current branch does not match
 * the name of your current branch`. So the remote half is `push -u`, which
 * re-points the upstream as it publishes (verified: `branch.feat2.merge`
 * becomes `refs/heads/feat2`), and never the panel's own `pushBranch` — which
 * reads the upstream first and issues a bare `git push`.
 *
 * The remote half is three commands and each is load-bearing:
 *
 *  1. `git push -u <remote> <new>` publishes the new name AND moves the
 *     upstream. Works on a branch that is not checked out (verified).
 *  2. `git push <remote> --delete <old>` removes the old name. This can be
 *     REFUSED by the server (`remote: error: By default, deleting the current
 *     branch is denied`), which is a real answer the user has to see.
 *  3. `git fetch --prune` drops the stale `origin/<old>` tracking ref, or the
 *     branch dropdown keeps offering a branch that no longer exists.
 *
 * The `-m` collision rule is git's: a name that already exists is refused,
 * including a case-only rename (`fatal: a branch named 'Main' already exists`),
 * and `-M` does not help that case either — measured. The dialog must not offer
 * "force" as a way around it.
 */
export async function renameBranch({ targetDir, from, to, remote }: RenameBranchOptions): Promise<string[]> {
  await assertValidBranchName(targetDir, to);
  const steps: string[] = [];

  // `--` separates the names from the options: a name git already refuses
  // cannot be read as a flag, and the separator makes that structural.
  await expectOk(['branch', '-m', '--', from, to], targetDir);
  steps.push(`git branch -m ${from} ${to}`);

  if (!remote) return steps;

  const remoteName = await firstRemote(targetDir);
  if (!remoteName) throw new Error('This repository has no remote to rename the branch on.');

  await expectOk(['push', '-u', remoteName, to], targetDir, 120_000);
  steps.push(`git push -u ${remoteName} ${to}`);
  await expectOk(['push', remoteName, '--delete', from], targetDir, 120_000);
  steps.push(`git push ${remoteName} --delete ${from}`);
  await expectOk(['fetch', '--prune', remoteName], targetDir, 120_000);
  steps.push(`git fetch --prune ${remoteName}`);
  return steps;
}

/** The repository's first remote, or null when it has none. */
async function firstRemote(cwd: string): Promise<string | null> {
  const result = await runGit(['remote'], { cwd, timeout: 5_000 });
  if (result.exitCode !== 0) return null;
  return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean)[0] ?? null;
}

export interface DeleteBranchOptions {
  targetDir: string;
  name: string;
  /**
   * `true` runs `-D`, which deletes a branch whose commits are not merged. The
   * caller only sets it after `-d` was refused AND the user confirmed — never
   * as a first attempt: `-d` refusing is git telling the user that deleting
   * this branch loses commits, and that message is the whole safety net.
   */
  force?: boolean;
}

/**
 * Delete a branch.
 *
 * `-d` refuses an unmerged branch (`error: the branch 'feat' is not fully
 * merged` — verified) and `-D` forces. The refusal is returned as-is so the
 * dialog can show git's own sentence and offer the explicit second step; it is
 * never swallowed into a generic failure.
 */
export async function deleteBranch({ targetDir, name, force }: DeleteBranchOptions): Promise<string> {
  await expectOk(['branch', force ? '-D' : '-d', '--', name], targetDir);
  return `git branch ${force ? '-D' : '-d'} ${name}`;
}
