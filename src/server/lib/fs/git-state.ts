/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Whether a working tree is in the middle of a git OPERATION — a merge, rebase,
 * cherry-pick, revert or `git am` that stopped and is waiting for a human.
 *
 * This is the read the panel was missing entirely, and its absence is why a
 * conflict was a dead end: the commit box said "Committing is not possible
 * because you have unmerged files", the discard button silently destroyed the
 * conflict while leaving the merge open, and nothing on screen said a merge was
 * in progress at all.
 *
 * **The state lives in FILES in the git directory, not in a command's exit
 * code.** Every probe below is a stat, because every alternative was measured
 * and is worse:
 *
 *  - `git rev-parse --git-path <name>` takes ONE name — passing five gives one
 *    path and then `fatal: ambiguous argument 'rebase-merge': unknown revision`
 *    — so a five-probe read would be five spawns.
 *  - It also returns a path RELATIVE to the cwd (`../../.git/MERGE_HEAD` from a
 *    subdirectory), which then has to be joined back.
 *  - `--absolute-git-dir` is absolute and resolves from any subdirectory
 *    (verified from `sub/deep/`), and it resolves correctly for a linked
 *    worktree — `<main>/.git/worktrees/<name>` — which is where that worktree's
 *    own operation state actually lives.
 *
 * So: one spawn for the directory, then stats.
 *
 * The conflict LIST is a separate read (`git ls-files -u`), because a
 * conflicted file can exist with no operation file at all — a conflicting
 * `git stash pop` leaves `UU f` and no `MERGE_HEAD`, `rebase-merge` or
 * `CHERRY_PICK_HEAD` (verified). In that state every `--abort` verb exits 128
 * with its own fatal, which is why `stash-pop` is a distinct operation name
 * here and not a null.
 */

import fs from 'node:fs';
import path from 'path';
import { runGit } from '@/server/lib/fs/git-run';
import type { GitOperation, GitState } from '@/shared/types';

// The state vocabulary lives in `shared/types/git.ts` because the panel renders
// it: two declarations of the same union would be two things to keep in step,
// and the client cannot import a server module.
export type { GitOperation, GitState };

/**
 * The paths git leaves behind, in the order they are checked.
 *
 * Exported because it is the vocabulary the state read is built on: a test
 * asserts every operation except `stash-pop` has a file here (and that
 * `stash-pop` deliberately does not), and the verb tables are keyed by the
 * operations this list can produce.
 */
export const OPERATION_PATHS: Array<{ name: string; operation: GitOperation }> = [
  { name: 'MERGE_HEAD', operation: 'merge' },
  { name: 'rebase-merge', operation: 'rebase' },
  { name: 'rebase-apply', operation: 'rebase-apply' },
  { name: 'CHERRY_PICK_HEAD', operation: 'cherry-pick' },
  { name: 'REVERT_HEAD', operation: 'revert' },
];

export interface GitStateOptions {
  /** Reuse an already-read git dir, so a caller that knows it spawns no second. */
  gitDir?: string;
}

/**
 * Read one working tree's operation state.
 *
 * Never throws: a directory that is not a repository (or a host without `git`)
 * answers `{operation: null, conflicts: [], detached: false}`, which is the
 * honest answer — there is no operation in progress in a tree git cannot read.
 */
export async function readGitState(targetDir: string, options: GitStateOptions = {}): Promise<GitState> {
  const empty: GitState = { operation: null, conflicts: [], detached: false };
  try {
    const gitDir = options.gitDir ?? await resolveGitDir(targetDir);
    if (!gitDir) return empty;

    const conflicts = await readConflicts(targetDir);
    const detached = await isDetachedHead(targetDir);

    for (const { name, operation } of OPERATION_PATHS) {
      // `fs.existsSync`, not `Bun.file().exists()`: measured, `rebase-merge` is
      // a DIRECTORY, and `Bun.file(<dir>).exists()` answers false for it — the
      // rebase state was reported as `stash-pop` (the fallthrough for "conflicts
      // with no operation file"), whose abort is `reset --merge HEAD` instead of
      // `rebase --abort`. `stat()` sees the directory; `existsSync` is the one
      // that is also correct for the FILE cases.
      if (fs.existsSync(path.join(gitDir, name))) {
        return { operation, conflicts, detached };
      }
    }
    // No operation file, but unmerged entries: a stash pop/apply that
    // conflicted. `git stash pop` leaves the stash entry in place precisely so
    // this can be retried, and `git reset --merge HEAD` is what clears it.
    if (conflicts.length > 0) return { operation: 'stash-pop', conflicts, detached };
    return { ...empty, detached };
  } catch {
    return empty;
  }
}

/** The absolute git directory, or null when this is not a repository. */
async function resolveGitDir(cwd: string): Promise<string | null> {
  const result = await runGit(['rev-parse', '--absolute-git-dir'], { cwd, timeout: 8_000 });
  if (result.exitCode !== 0) return null;
  const dir = result.stdout.trim();
  return dir || null;
}

/**
 * Repo-relative paths with unmerged index entries.
 *
 * `ls-files -u -z` rather than `git diff --name-only --diff-filter=U`: `-z` is
 * the lossless form (the same reason `parsePorcelainZ` uses it — a path with a
 * space, a quote or a non-ASCII byte comes back quoted and octal-escaped
 * otherwise), and it prints one record PER STAGE (1 = base, 2 = ours,
 * 3 = theirs), so the dedupe below is required rather than optional.
 *
 * A record is `<mode> <sha> <stage>\t<path>`.
 */
async function readConflicts(cwd: string): Promise<string[]> {
  const result = await runGit(['ls-files', '-u', '-z'], { cwd, timeout: 8_000 });
  if (result.exitCode !== 0) return [];
  const paths = new Set<string>();
  for (const record of result.stdout.split('\0')) {
    const tab = record.indexOf('\t');
    if (tab === -1) continue;
    const file = record.slice(tab + 1);
    if (file) paths.add(file);
  }
  return [...paths];
}

/**
 * True when HEAD names no branch.
 *
 * The branch read marks HEAD from `%(HEAD)` in `for-each-ref`, and a detached
 * checkout marks nothing — so it falls to `git rev-parse --abbrev-ref HEAD`,
 * which prints the literal string `HEAD`. That string then reaches the branch
 * list as a branch the user can check out (measured: `branches: ["HEAD",
 * "main"]`), and during a REBASE CONFLICT it is what the panel shows as the
 * current branch, because a rebase detaches HEAD too.
 */
async function isDetachedHead(cwd: string): Promise<boolean> {
  const result = await runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd, timeout: 8_000 });
  return result.exitCode !== 0;
}

/** Human wording for an operation, for a banner or a refusal message. */
export { OPERATION_LABELS } from '@/shared/lib/fs/git-unmerged';

/** The abort verb per operation — the ONE place the mapping is written down. */
export function abortArgsFor(operation: GitOperation): string[] {
  switch (operation) {
    case 'merge':
      return ['merge', '--abort'];
    case 'rebase':
    case 'rebase-apply':
      return ['rebase', '--abort'];
    case 'cherry-pick':
      return ['cherry-pick', '--abort'];
    case 'revert':
      return ['revert', '--abort'];
    case 'stash-pop':
      // The only one with no git verb of its own: a conflicting stash pop
      // leaves unmerged entries and no operation file, so every `--abort`
      // answers "no <op> in progress". `--merge` resets the index and the
      // conflicted paths to HEAD and leaves the stash entry in place
      // (verified), so the pop can be retried.
      return ['reset', '--merge', 'HEAD'];
  }
}
