/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Remove a worktree, in an order that is the REVERSE of OpenChamber's and
 * deliberately so: the omp child holds the worktree as its cwd, so the sessions
 * are stopped and deleted FIRST and only then does the directory go away.
 *
 * A child still holding a deleted cwd is the case `resolveSpawnCwd` papers over
 * by silently running the session in the server's own directory — a session the
 * user asked to delete, alive somewhere else.
 *
 * Nothing here passes `--force`. A dirty worktree refuses (measured: git exits
 * 128 with "contains modified or untracked files") and the caller reports the
 * count instead of destroying work, so the refusal is recoverable.
 */

import { existsSync, rmSync } from 'fs';
import path from 'path';
import { canonicalPath, pathHolds } from '@/server/lib/fs/canonical';
import { runGit } from '@/server/lib/fs/git-run';
import { resolveProjectRoot } from '@/server/lib/omp/core/worktree';
import { WorktreeError } from '@/server/lib/fs/worktree/errors';
import { listWorktrees } from '@/server/lib/fs/worktree/list';

/** Changed + untracked count in `directory`; 0 when git cannot answer. */
export async function dirtyCount(directory: string): Promise<number> {
  const result = await runGit(['status', '--porcelain'], { cwd: directory, maxBuffer: 4 * 1024 * 1024 });
  if (result.exitCode !== 0) return 0;
  return result.stdout.split('\n').filter((line) => line.trim()).length;
}

/** Commits on `branch` that are not on `startRef`; null when it cannot be told. */
export async function commitsAheadOf(
  repo: string,
  startRef: string,
  branch: string,
): Promise<number | null> {
  if (!startRef || !branch) return null;
  const result = await runGit(['rev-list', '--count', `${startRef}..${branch}`], { cwd: repo });
  if (result.exitCode !== 0) return null;
  const value = Number.parseInt(result.stdout.trim(), 10);
  return Number.isFinite(value) ? value : null;
}

export interface RemoveWorktreeInput {
  /** Absolute worktree path as the caller holds it (any spelling). */
  worktreePath: string;
  /** Any directory inside the repository — used for the git commands. */
  projectPath: string;
  /** Delete the branch too, attempted with `git branch -d` only. */
  deleteBranch?: boolean;
  /**
   * `<data dir>/worktrees` — a root Kabmo owns outright, where a leftover
   * directory may be cleaned even after git stopped tracking it. A CONFIGURED
   * root is not this: there, only a path git still lists is ever touched.
   */
  managedRoot?: string | null;
  /**
   * Destroy the live children whose cwd is inside, and delete or archive their
   * sessions. Runs BEFORE anything is removed; returns the ids it handled.
   */
  stopSessions?: (worktreePath: string) => Promise<string[]>;
}

export interface RemoveWorktreeDeps {
  rowFor: (worktreePath: string) => Promise<{ start_ref: string } | undefined>;
  removeRow: (worktreePath: string) => Promise<void>;
}

export interface RemovedWorktree {
  removed: true;
  archived: string[];
  branchDeleted: boolean;
  /** True when the user asked for the branch and git refused to lose it. */
  branchKept: boolean;
}

export async function removeWorktree(
  input: RemoveWorktreeInput,
  deps: RemoveWorktreeDeps,
): Promise<RemovedWorktree> {
  const requested = path.resolve(input.worktreePath);
  const insideManagedRoot = input.managedRoot ? await pathHolds(input.managedRoot, requested) : false;

  const insideWorkTree = await runGit(['rev-parse', '--is-inside-work-tree'], { cwd: input.projectPath });
  if (insideWorkTree.exitCode !== 0 || insideWorkTree.stdout.trim() !== 'true') {
    throw new WorktreeError('not_a_repo', 'This folder is not a Git repository.');
  }

  const primaryRoot = await resolveProjectRoot(input.projectPath);
  const entries = await listWorktrees(primaryRoot);
  const target = await canonicalPath(requested);
  const entry = entries.find((candidate) => candidate.path === target);

  if (!entry) {
    // Not registered: only a directory inside a root we own may be cleaned, and
    // only because git already let it go.
    if (!insideManagedRoot) {
      throw new WorktreeError('not_a_worktree', `${requested} is not a worktree of this repository.`);
    }
    await runGit(['worktree', 'prune'], { cwd: primaryRoot });
    if (existsSync(requested)) rmSync(requested, { recursive: true, force: true });
    await deps.removeRow(target);
    return { removed: true, archived: [], branchDeleted: false, branchKept: false };
  }

  if (entry.isPrimary) {
    throw new WorktreeError('primary_checkout', 'The main checkout cannot be removed.');
  }

  const archived = input.stopSessions ? await input.stopSessions(entry.path) : [];

  const dirty = await dirtyCount(entry.path);
  if (dirty > 0) {
    throw new WorktreeError(
      'dirty',
      `${dirty} uncommitted file${dirty === 1 ? '' : 's'} here would be lost.`,
      { count: dirty },
    );
  }

  const removed = await runGit(['worktree', 'remove', entry.path], { cwd: primaryRoot });
  if (removed.exitCode !== 0) {
    throw new WorktreeError(
      'remove_failed',
      removed.stderr.trim() || removed.stdout.trim() || `git exited ${removed.exitCode}`,
    );
  }
  await runGit(['worktree', 'prune'], { cwd: primaryRoot });

  // The branch: `-d` only. Its refusal IS the safety net, so a branch with
  // commits of its own survives and the answer says so.
  let branchDeleted = false;
  let branchKept = false;
  if (input.deleteBranch && entry.branch) {
    const row = await deps.rowFor(entry.path);
    const ahead = await commitsAheadOf(primaryRoot, row?.start_ref ?? '', entry.branch);
    if (ahead !== null && ahead > 0) {
      branchKept = true;
    } else {
      const deleted = await runGit(['branch', '-d', entry.branch], { cwd: primaryRoot });
      branchDeleted = deleted.exitCode === 0;
      branchKept = !branchDeleted;
    }
  }

  await deps.removeRow(entry.path);
  return { removed: true, archived, branchDeleted, branchKept };
}