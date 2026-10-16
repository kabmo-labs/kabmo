/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The git status read for one working tree: branch, branch lists, changed files
 * and (on request) the ahead/behind count.
 *
 * Extracted from `routes/fs/git.ts` so the HTTP route and the realtime `git:`
 * topic answer from ONE implementation. Two copies would drift on the details
 * that matter — which files count as staged, how a rename is unwrapped, how a
 * detached HEAD is named — and the panel would then show a different list
 * depending on which path delivered it.
 *
 * Read-only: the caller supplies a directory inside a root it has already
 * resolved.
 */

import { runShell } from '@/server/lib/fs/shell';
import { GIT_ENV, parsePorcelainZ } from '@/server/lib/fs/git-run';
import { gitSyncCount, refreshRemoteRefs } from '@/server/lib/fs/git-sync';
import { readGitState } from '@/server/lib/fs/git-state';
import type { GitChange, GitState } from '@/shared/types';

export interface GitStatusPayload {
  changes: GitChange[];
  branch: string;
  branches: string[];
  remoteBranches: string[];
  syncCount?: { ahead: number; behind: number };
  /**
   * Whether an operation is in progress (merge/rebase/cherry-pick/revert/stash
   * pop), the conflicted paths, and whether HEAD is detached.
   *
   * Travels on the payload rather than a second endpoint because the panel
   * reads this from the `git:` realtime topic: a merge started by a tool call
   * has to reach the panel the same way a change to the tree does, and a second
   * read path is a second answer.
   */
  state?: GitState;
  error?: string;
}

/**
 * How the ahead/behind count is produced, when one is asked for at all.
 *
 * - `fetch` — refresh the branch's remote-tracking ref first, so `behind`
 *   describes origin rather than the last fetch. A network round trip, TTL'd
 *   inside the helper. The git panel's own read (mount and Refresh) uses it.
 * - `local` — count against the tracking ref as it stands. ~15ms of `git
 *   rev-list`, no network, so the realtime `git:` topic can carry a count that
 *   follows every push (a tool call's commit) without turning each one into a
 *   fetch.
 *
 * Omitted means no count at all: the status-only readers (the activity bar's
 * dot, the file explorer) must not pay for a value they never read.
 */
export type GitCountMode = 'fetch' | 'local';

export interface GitStatusOptions {
  count?: GitCountMode;
}

/**
 * Read one working tree's status.
 *
 * Never throws: a directory that is not a repository (or a host without `git`)
 * answers an empty change list with the error text, which is what the panel
 * renders — a thrown error would take the whole response down over a directory
 * the user merely pointed at.
 */
export async function readGitStatus(targetDir: string, options: GitStatusOptions = {}): Promise<GitStatusPayload> {
  const countMode = options.count;
  try {
    // Started before the local probes below so the fetch overlaps them instead
    // of adding up. `local` deliberately starts nothing: the tracking ref is
    // read where it stands.
    const remoteRefresh = countMode === 'fetch' ? refreshRemoteRefs(targetDir) : Promise.resolve();
    // The operation/conflict read runs alongside the status probe for the same
    // reason: it is one `rev-parse` plus stats, and awaiting it serially would
    // add a spawn to every panel refresh.
    const stateRead = readGitState(targetDir);

    // `--porcelain=v1 -z -uall` so all individual edited/untracked files are
    // listed, and so a path holding a space, a quote or a non-ASCII byte
    // arrives VERBATIM. The non-`-z` form quotes those and octal-escapes the
    // non-ASCII ones, which no decode reverses — see `parsePorcelainZ`.
    const statusOut = (await runShell('git status --porcelain=v1 -z -uall', { cwd: targetDir, maxBuffer: 4 * 1024 * 1024, env: GIT_ENV })).stdout;

    let branch = 'main';
    // Seeded empty, not `['main']`: the seed used to be pushed as a real local
    // branch, so a repository whose only branch is `main` listed it twice.
    const branches: string[] = [];
    const remoteBranches: string[] = [];
    try {
      // One `for-each-ref` answers all three questions the three previous
      // spawns asked separately (`rev-parse --abbrev-ref HEAD`, `branch`,
      // `branch -r`): `%(HEAD)` marks the checked-out branch with `*`, and the
      // two refspecs cover local and remote in one listing. Measured 8.15 ms
      // against 19.63 ms for the three-call form.
      //
      // Classification reads the FULL refname: `%(refname:short)` maps
      // `refs/remotes/origin/HEAD` to the bare `origin`, which has no slash and
      // would otherwise be listed as a local branch.
      const refsOut = (await runShell(
        'git for-each-ref --format="%(refname)%09%(refname:short)%09%(HEAD)" refs/heads refs/remotes',
        { cwd: targetDir },
      )).stdout;
      let sawHead = false;
      for (const line of refsOut.split('\n')) {
        const [full, short, head] = line.split('\t');
        if (!full || !short) continue;
        // `refs/remotes/origin/HEAD` is a symbolic alias, not a branch.
        if (full.endsWith('/HEAD')) continue;
        if (full.startsWith('refs/remotes/')) {
          remoteBranches.push(short);
          continue;
        }
        branches.push(short);
        if (head === '*') {
          branch = short;
          sawHead = true;
        }
      }
      // Detached HEAD: no local ref is marked, and the branch is the sha
      // `rev-parse --abbrev-ref HEAD` prints. Ask for it rather than reporting
      // a branch the checkout is not on.
      if (!sawHead) {
        const headOut = await runShell('git rev-parse --abbrev-ref HEAD', { cwd: targetDir, env: GIT_ENV });
        branch = headOut.stdout.trim() || 'main';
      }
    } catch {
      // ignore branch resolution errors
    }

    const changes: GitChange[] = parsePorcelainZ(statusOut);
    const state = await stateRead;

    // `main` remains the answer only when nothing could be read (a non-repo
    // directory, git missing) — a real listing always supplies its own refs.
    // A DETACHED checkout is the exception: `rev-parse` answers the literal
    // string `HEAD`, which then listed as a branch the user can check out
    // (measured: `branches: ["HEAD", "main"]`). The state read is what knows,
    // so the literal is dropped from the list and the branch is reported as
    // the detached head it is.
    const detachedBranch = state.detached ? branch : '';
    const localBranches = branches.filter((b) => !detachedBranch || b !== detachedBranch);
    if (localBranches.length === 0) localBranches.push('main');
    else if (!detachedBranch && !localBranches.includes(branch)) localBranches.unshift(branch);

    await remoteRefresh;
    const syncCount = countMode ? await gitSyncCount(targetDir) : undefined;

    return {
      changes,
      branch: branch || 'main',
      branches: localBranches,
      remoteBranches,
      syncCount,
      state,
    };
  } catch (error) {
    return {
      changes: [],
      branch: 'main',
      branches: ['main'],
      remoteBranches: [],
      syncCount: { ahead: 0, behind: 0 },
      state: { operation: null, conflicts: [], detached: false },
      error: error instanceof Error ? error.message : 'Git error',
    };
  }
}
