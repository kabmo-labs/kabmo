/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `git worktree list --porcelain`, parsed into rows.
 *
 * The two markers a naive parse loses, and both matter to a reader:
 *
 *  - **no `branch` line** → detached HEAD, which the row shows as `detached @
 *    <sha>` and the delete dialog treats as not-a-branch;
 *  - **`prunable`** → the directory is gone or the gitdir pointer is broken. The
 *    entry STAYS in the list: the sessions that lived there must keep their row,
 *    and dropping it would hide them with no way back.
 *
 * Paths are canonicalized here, once, for every consumer — git echoes the
 * spelling it was given while the repository root resolves through symlinks, and
 * two spellings of one directory must not read as two worktrees.
 */

import { existsSync } from 'fs';
import { canonicalPath } from '@/server/lib/fs/canonical';
import { runGit } from '@/server/lib/fs/git-run';
import { resolveProjectRoot } from '@/server/lib/omp/core/worktree';

export interface WorktreeEntry {
  path: string;
  /** `refs/heads/` stripped; `''` when detached. */
  branch: string;
  head: string;
  detached: boolean;
  /** git reports it prunable, or the directory is not there. */
  missing: boolean;
  /** The checkout the worktree was created from — never removable. */
  isPrimary: boolean;
}

/** Split on blank lines; a bare repository is not a checkout anything can run in. */
export function parseWorktreePorcelain(stdout: string): Omit<WorktreeEntry, 'isPrimary'>[] {
  interface Pending {
    path: string;
    branch?: string;
    head?: string;
    missing: boolean;
    bare: boolean;
  }

  const entries: Omit<WorktreeEntry, 'isPrimary'>[] = [];
  let current: Pending | null = null;

  const flush = () => {
    if (!current?.path || current.bare) {
      current = null;
      return;
    }
    const branch = current.branch ?? '';
    const head = current.head ?? '';
    entries.push({
      path: current.path,
      branch,
      head,
      detached: !branch && Boolean(head),
      missing: current.missing,
    });
    current = null;
  };

  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trimEnd();
    if (!line) {
      flush();
      continue;
    }
    if (line.startsWith('worktree ')) {
      flush();
      current = { path: line.slice('worktree '.length).trim(), missing: false, bare: false };
      continue;
    }
    if (!current) continue;
    if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length).trim();
      continue;
    }
    if (line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '');
      continue;
    }
    if (line === 'bare') current.bare = true;
    if (line === 'prunable' || line.startsWith('prunable ')) current.missing = true;
  }
  flush();

  return entries;
}

/** Every worktree of the repository `cwd` belongs to, primary first. */
export async function listWorktrees(cwd: string): Promise<WorktreeEntry[]> {
  const primaryRoot = await resolveProjectRoot(cwd);
  const listed = await runGit(['worktree', 'list', '--porcelain'], { cwd: primaryRoot, maxBuffer: 1024 * 1024 });
  if (listed.exitCode !== 0) throw new Error(listed.stderr.trim() || 'Failed to list git worktrees');

  const canonicalPrimary = await canonicalPath(primaryRoot);
  const entries: WorktreeEntry[] = [];
  for (const entry of parseWorktreePorcelain(listed.stdout)) {
    const canonical = await canonicalPath(entry.path);
    entries.push({
      ...entry,
      path: canonical,
      isPrimary: canonical === canonicalPrimary,
      // A directory removed without `prune` answers `existsSync` false, and both
      // signals mean the same thing to a reader.
      missing: entry.missing || !existsSync(canonical),
    });
  }
  return entries;
}

/** Whether `branch` is checked out in any worktree of this repository, and where. */
export async function findBranchInUse(cwd: string, branch: string): Promise<{ path: string } | null> {
  const entries = await listWorktrees(cwd);
  const hit = entries.find((entry) => entry.branch === branch);
  return hit ? { path: hit.path } : null;
}

export async function refExists(cwd: string, ref: string): Promise<boolean> {
  const probe = await runGit(['show-ref', '--verify', '--quiet', ref], { cwd });
  return probe.exitCode === 0;
}