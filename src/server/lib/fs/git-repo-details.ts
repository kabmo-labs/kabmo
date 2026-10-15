/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One row per repository for the repo management modal: the branch, whether
 * anything is uncommitted, how far ahead/behind the upstream it is, and whether
 * an operation is stopped on a conflict.
 *
 * **A read of its own, not the panel's status payload repeated per repo.** The
 * panel's `readGitStatus` answers for ONE tree and carries the whole change
 * LIST (up to megabytes of porcelain for a repo with thousands of untracked
 * files). A modal showing fifty rows needs fifty counts and no lists, so the
 * per-repo read is `git status --porcelain=v2 --branch` — one spawn that states
 * every field a row shows — plus the HEAD subject and the operation probe.
 *
 * Measured on the author's workspace (144 nested repos, warm cache): the walk
 * itself is 284 ms, and the per-repo reads are 302 ms at a concurrency of 12.
 * Concurrency is bounded rather than `Promise.all` for exactly that reason — a
 * workspace of nested repos is routinely in the hundreds, and one spawn per
 * repo released at once would fork hundreds of processes to answer one dialog.
 *
 * Deliberately NOT on the `git:` realtime topic and not part of any payload the
 * server publishes on a tool call: this is opened by hand, and a publish that
 * carried it would pay a spawn per repo per tool call.
 */

import path from 'path';
import { runGit } from '@/server/lib/fs/git-run';
import { parsePorcelainV2 } from '@/server/lib/fs/git-porcelain-v2';
import { isWithinRoot } from '@/server/lib/fs/root';
import { OPERATION_PATHS } from '@/server/lib/fs/git-state';
import { existsSync } from 'node:fs';
import type { GitRepoDetail } from '@/shared/types';

/** How many repositories are read at once. */
const CONCURRENCY = 8;

/**
 * Read one repository's row.
 *
 * Never throws: a directory that is not a repository answers `isRepo: false`
 * with git's own message, which is what the modal renders for the workspace
 * root when it is a folder of nested repos rather than a repo itself.
 */
export async function readRepoDetail(rootDir: string, repo: string): Promise<GitRepoDetail> {
  const empty: GitRepoDetail = {
    path: repo,
    isRepo: false,
    branch: '',
    detached: false,
    changed: 0,
    untracked: 0,
    ahead: 0,
    behind: 0,
    upstream: '',
    gone: false,
    operation: null,
    conflicts: 0,
    subject: '',
    date: '',
  };

  const targetDir = repo === '.' ? rootDir : path.resolve(rootDir, repo);
  if (!isWithinRoot(rootDir, targetDir)) return { ...empty, error: 'Invalid repo path' };

  const status = await runGit(
    ['status', '--porcelain=v2', '--branch', '-z', '-uall'],
    { cwd: targetDir, timeout: 15_000, maxBuffer: 8 * 1024 * 1024 },
  );
  if (status.exitCode !== 0) {
    return { ...empty, error: status.stderr.trim() || 'Not a git repository' };
  }

  const summary = parsePorcelainV2(status.stdout);
  const detail: GitRepoDetail = {
    ...empty,
    isRepo: true,
    branch: summary.branch,
    detached: summary.detached,
    changed: summary.changed,
    untracked: summary.untracked,
    ahead: summary.ahead,
    behind: summary.behind,
    upstream: summary.upstream,
    gone: summary.gone,
    conflicts: summary.conflicts,
  };

  // The two reads below are independent, so they overlap instead of adding up.
  const [head, operation] = await Promise.all([
    summary.hasCommits ? readHeadCommit(targetDir) : Promise.resolve({ subject: '', date: '' }),
    readOperation(targetDir, summary.conflicts),
  ]);
  return { ...detail, ...head, operation };
}

/**
 * HEAD's subject and relative date.
 *
 * `%x00` separates the two fields: a commit subject is free to hold any byte
 * except NUL, and git does not strip a tab out of the middle of one, so a
 * tab-separated read could split a subject in half. Skipped entirely on an
 * unborn branch, where `git log` exits 128 ("does not have any commits yet").
 */
async function readHeadCommit(targetDir: string): Promise<{ subject: string; date: string }> {
  const result = await runGit(['log', '-1', '--format=%s%x00%cr'], { cwd: targetDir, timeout: 8_000 });
  if (result.exitCode !== 0) return { subject: '', date: '' };
  const [subject, date] = result.stdout.split('\0');
  return { subject: (subject ?? '').trim(), date: (date ?? '').trim() };
}

/**
 * The operation a tree is stopped in, or null.
 *
 * One `rev-parse` for the git dir and then STATS — the same reasoning
 * `lib/fs/git-state.ts` documents for its own read, and the reason it is not
 * reused wholesale here: that function also reads the conflict list
 * (`ls-files -u`) and the detached flag (`symbolic-ref`), both of which the
 * porcelain read above has already answered, and two more spawns per repo for
 * values already in hand is the cost this row cannot pay.
 *
 * `existsSync`, not `Bun.file().exists()`: `rebase-merge` is a DIRECTORY, and
 * the BunFile probe answers false for it — which reported a rebase as a
 * conflicted stash pop.
 */
async function readOperation(targetDir: string, conflicts: number): Promise<GitRepoDetail['operation']> {
  const gitDirResult = await runGit(['rev-parse', '--absolute-git-dir'], { cwd: targetDir, timeout: 8_000 });
  if (gitDirResult.exitCode !== 0) return null;
  const gitDir = gitDirResult.stdout.trim();
  if (!gitDir) return null;
  for (const { name, operation } of OPERATION_PATHS) {
    if (existsSync(path.join(gitDir, name))) return operation;
  }
  // No operation file, but unmerged entries: a stash pop/apply that conflicted.
  // It is the one conflict shape git records nowhere else, and `stash-pop` is
  // the name the panel already gives it — whose abort is `reset --merge HEAD`
  // rather than an `--abort` verb.
  return conflicts > 0 ? 'stash-pop' : null;
}

/**
 * Every row of the modal: one read per discovered repo, bounded.
 *
 * `repos` comes from the discovery walk and is already root-relative; a path
 * that escapes the root is refused per row rather than aborting the pass, so one
 * malformed entry cannot blank the whole list.
 */
export async function readRepoDetails(rootDir: string, repos: readonly string[]): Promise<GitRepoDetail[]> {
  const rows: GitRepoDetail[] = new Array(repos.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, repos.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= repos.length) return;
      rows[index] = await readRepoDetail(rootDir, repos[index]);
    }
  });
  await Promise.all(workers);
  return rows;
}
