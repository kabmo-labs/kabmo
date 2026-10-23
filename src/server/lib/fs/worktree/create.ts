/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Create a worktree, in the order that matters.
 *
 * Every refusal git would only raise mid-way is checked FIRST, because git
 * creates the branch before it discovers the problem. Measured on git 2.56:
 * `git worktree add` prints `Preparing worktree`, creates the branch, and only
 * then fails with "already checked out", "already exists", or for an unborn
 * branch `object not found: HEAD` — each leaving a branch behind for a create
 * the user was told had failed.
 *
 * Two deliberate absences:
 *
 *  - **no `--force`**, so git never overwrites a directory or steals a branch
 *    another worktree holds;
 *  - **no carry of uncommitted changes.** Their edits are indistinguishable from
 *    another session's in the same checkout, and a `stash`+`apply` is a
 *    repository-wide operation that can take them. The dialog says the changes
 *    stay put, and this is what makes that true.
 */

import path from 'path';
import { mkdir } from 'fs/promises';
import { getDataDir } from '@/server/lib/lifecycle/paths';
import { runGit } from '@/server/lib/fs/git-run';
import { canonicalPath } from '@/server/lib/fs/canonical';
import { resolveProjectRoot } from '@/server/lib/omp/core/worktree';
import { pathExists } from '@/server/lib/omp/core/paths';
import {
  folderNameForBranch,
  isPlausibleBranchName,
  normalizeBranchName,
  slugWorktreeName,
  WORKTREE_BRANCH_PREFIX,
} from '@/shared/lib/workspace/worktree/branch-name';
import type { WorktreeInfo } from '@/shared/lib/workspace/worktree/types';
import { carryIgnoredInto, type CarryResult } from '@/server/lib/fs/worktree/carry';
import { WorktreeError } from '@/server/lib/fs/worktree/errors';
import {
  defaultWorktreeRoot,
  resolveConfiguredWorktreeRoot,
  resolveTargetDirectory,
} from '@/server/lib/fs/worktree/location';
import { findBranchInUse, refExists } from '@/server/lib/fs/worktree/list';
import { resolveProjectId } from '@/server/lib/fs/worktree/project-id';

/**
 * The `-c` flags a create carries.
 *
 * `core.longpaths` is not cosmetic: the data-dir prefix plus a nested repository
 * path exceeds Windows' 260-character MAX_PATH, and git then fails during the
 * checkout with "Filename too long" and leaves a half-populated worktree.
 * `core.hooksPath` keeps a repository's hooks out of a checkout Kabmo makes.
 */
export const WORKTREE_ADD_CONFIG = [
  'core.longpaths=true',
  `core.hooksPath=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`,
];

export interface CreateWorktreeInput {
  /** Absolute path of the project (or any directory inside the repository). */
  projectPath: string;
  mode: 'new' | 'existing';
  /** The branch: free text in `new`, a pick in `existing`. Empty generates one. */
  branch?: string;
  /** The folder name from the dialog; empty follows the branch. */
  worktreeName?: string;
  startRef?: string;
  /** Overrides the stored setting, which is what the dialog's Quick path does. */
  carryIgnored?: boolean;
}

export interface CreatedWorktree extends WorktreeInfo {
  projectId: string;
  primaryRoot: string;
  carried: CarryResult | null;
  /** False for `existing`, where the branch already belonged to the repository. */
  createdBranch: boolean;
}

export interface CreateWorktreeDeps {
  /** The identity cache, in production `worktreeIdentityFor(getDb(), …)`. */
  identityFor: (primaryRoot: string) => Promise<string | null>;
  /** The stored carry default; the request may override it. */
  carryIgnored: boolean;
  dataDir?: string;
  configuredDirectory?: string | null;
  /** Called with the finished row — the registry write, injected for tests. */
  record: (row: {
    path: string;
    primaryRoot: string;
    projectId: string;
    branch: string;
    startRef: string;
    createdAt: string;
  }) => Promise<void>;
}

async function gitOk(args: string[], cwd: string): Promise<string> {
  const result = await runGit(args, { cwd, maxBuffer: 4 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || `git exited ${result.exitCode}`);
  return result.stdout;
}

/** Resolve the destination the create would use, without touching disk. */
export async function planWorktree(
  input: CreateWorktreeInput,
  deps: Pick<CreateWorktreeDeps, 'identityFor' | 'dataDir' | 'configuredDirectory'>,
): Promise<{ primaryRoot: string; projectId: string; root: string; name: string; directory: string; branch: string; startRef: string }> {
  const projectPath = path.resolve(input.projectPath);
  const insideWorkTree = await runGit(['rev-parse', '--is-inside-work-tree'], { cwd: projectPath });
  if (insideWorkTree.exitCode !== 0 || insideWorkTree.stdout.trim() !== 'true') {
    throw new WorktreeError('not_a_repo', 'This folder is not a Git repository.');
  }

  const primaryRoot = await resolveProjectRoot(projectPath);
  const head = await runGit(['rev-parse', '--verify', 'HEAD'], { cwd: primaryRoot });
  if (head.exitCode !== 0) {
    throw new WorktreeError('no_commits', 'This repository has no commits yet.');
  }

  const existing = input.mode === 'existing';
  // The RAW name is validated, then normalized only by stripping a ref prefix.
  // Normalizing first was a silent rewrite: `normalizeBranchName` turns spaces
  // into dashes, so a typed `has space` became the valid `has-space` and the
  // dialog created a branch the user never asked for.
  const typed = (input.branch ?? '').trim();
  const requested = normalizeBranchName(typed);
  if (existing && !requested) {
    throw new WorktreeError('invalid_name', 'Pick a branch to check out.', { field: 'branch' });
  }
  if (typed && !isPlausibleBranchName(typed)) {
    throw new WorktreeError('invalid_name', `"${typed}" is not a valid branch name.`, { field: 'branch' });
  }
  if (requested) {
    const exists = await refExists(primaryRoot, `refs/heads/${requested}`);
    if (existing && !exists) {
      throw new WorktreeError('branch_exists', `Branch ${requested} does not exist.`, { field: 'branch' });
    }
    if (!existing && exists) {
      throw new WorktreeError('branch_exists', `Branch ${requested} already exists.`, { field: 'branch' });
    }
    const inUse = await findBranchInUse(primaryRoot, requested);
    if (inUse) {
      throw new WorktreeError('branch_in_use', `${requested} is already checked out in ${inUse.path}.`, {
        field: 'branch',
      });
    }
  }

  const projectId = await resolveProjectId(primaryRoot, deps.identityFor);
  const dataDir = deps.dataDir ?? getDataDir();
  // Canonical from the start: the directory is compared against git's own paths
  // and stored as a primary key, and two spellings of one folder must be one
  // row (macOS: `/tmp` typed, `/private/tmp` reported).
  const root = await canonicalPath(
    resolveConfiguredWorktreeRoot(deps.configuredDirectory ?? null, primaryRoot)
      ?? defaultWorktreeRoot(dataDir, projectId),
  );

  // The folder follows the branch unless the dialog named one; a non-Latin
  // branch leaves no slug, so a generated name stands in rather than an empty
  // folder.
  const candidateName = input.worktreeName?.trim() || folderNameForBranch(requested) || slugWorktreeName(requested);
  const target = await resolveTargetDirectory({
    root,
    preferredName: candidateName,
    // The branch the user typed is used VERBATIM in both modes; only an empty
    // one generates. Passing it as generated for `new` renamed a typed
    // `分支/测试` to `wt/lucid-toucan` — measured, and the caller never sees the
    // branch it asked for.
    explicitBranch: requested || null,
    generatedBranch: (name) => `${WORKTREE_BRANCH_PREFIX}/${name}`,
    branchExists: async (branch) => Boolean(await findBranchInUse(primaryRoot, branch)) || refExists(primaryRoot, `refs/heads/${branch}`),
  });

  const startRef = input.startRef?.trim() || 'HEAD';
  return { primaryRoot, projectId, root, name: target.name, directory: target.directory, branch: target.branch, startRef };
}

/** Create the worktree, carry the ignored build folders, and record the row. */
export async function createWorktree(
  input: CreateWorktreeInput,
  deps: CreateWorktreeDeps,
): Promise<CreatedWorktree> {
  const plan = await planWorktree(input, deps);
  const existing = input.mode === 'existing';
  const carry = input.carryIgnored ?? deps.carryIgnored;

  await mkdir(plan.root, { recursive: true });

  // git's grammar is `worktree add [--no-checkout] [-b <new>] <path> [<commit-ish>]`:
  // an EXISTING branch is the commit-ish and therefore follows the path.
  // Measured: putting the branch first is read as the path and git answers
  // `fatal: invalid reference: <the path we meant to use>`.
  // ONE `-c` per pair: `['-c', a, b, 'worktree']` makes git read `b` as the
  // SUBCOMMAND, and it answers `git: 'core.hooksPath=/dev/null' is not a git
  // command` — measured, and every create failed on it.
  const configArgs = WORKTREE_ADD_CONFIG.flatMap((pair) => ['-c', pair]);
  const args = [...configArgs, 'worktree', 'add', '--no-checkout'];
  if (existing) {
    args.push(plan.directory, plan.branch);
  } else {
    args.push('-b', plan.branch, plan.directory);
    if (plan.startRef !== 'HEAD') args.push(plan.startRef);
  }

  try {
    await gitOk(args, plan.primaryRoot);
    // `--no-checkout` keeps the add cheap; the same flags then populate it, so a
    // path that cannot be checked out fails HERE and is reported.
    await gitOk([...configArgs, 'checkout'], plan.directory);
  } catch (error) {
    // A failed create leaves nothing behind: the branch was ours, so it goes.
    if (!existing) {
      await runGit(['branch', '-D', plan.branch], { cwd: plan.primaryRoot });
    }
    throw new WorktreeError('create_failed', error instanceof Error ? error.message : String(error));
  }

  let carried: CarryResult | null = null;
  if (carry) {
    try {
      carried = await carryIgnoredInto({ primaryRoot: plan.primaryRoot, worktreePath: plan.directory });
    } catch (error) {
      // Reported, not fatal: a worktree without node_modules is still a worktree.
      carried = { copied: [], skipped: [], strategy: 'plain' };
      void error;
    }
  }

  const createdAt = new Date().toISOString();
  await deps.record({
    path: plan.directory,
    primaryRoot: plan.primaryRoot,
    projectId: plan.projectId,
    branch: plan.branch,
    startRef: existing ? '' : plan.startRef,
    createdAt,
  });

  return {
    path: plan.directory,
    branch: plan.branch,
    head: (await runGit(['rev-parse', 'HEAD'], { cwd: plan.directory })).stdout.trim(),
    detached: false,
    missing: !(await pathExists(plan.directory)),
    isPrimary: false,
    dirty: 0,
    aheadOfStart: 0,
    startRef: existing ? '' : plan.startRef,
    sessions: 0,
    projectId: plan.projectId,
    primaryRoot: plan.primaryRoot,
    carried,
    createdBranch: !existing,
  };
}