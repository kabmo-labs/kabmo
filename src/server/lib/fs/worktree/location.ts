/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Where a worktree lands — OpenChamber's rule, adopted as-is:
 *
 *   root = configured directory (resolved) || <data dir>/worktrees/<projectID>
 *   path = <root>/<name>
 *
 * Three spellings for the setting, unchanged from theirs: a relative path
 * resolves against the CANONICAL checkout (so a linked worktree still reads the
 * project's own setting), an absolute path is used as-is, and `~` means the home
 * directory. The resolved value is always the PARENT — the name is appended.
 *
 * A name is never refused because it is taken: candidates are tried in order, so
 * "quick otter" in a repository that already has one becomes
 * `quick-otter-cosmic-dolphin` rather than an error the user has to read.
 */

import path from 'path';
import { homedir } from 'os';
import { pathExists } from '@/server/lib/omp/core/paths';
import {
  generateBranchSlug,
  slugWorktreeName,
  WORKTREE_BRANCH_PREFIX,
} from '@/shared/lib/workspace/worktree/branch-name';

/** How many names to try before giving up. OpenChamber's 26, kept. */
export const WORKTREE_NAME_ATTEMPTS = 26;

/**
 * Resolve the setting into a parent directory. `null` when unset, so the caller
 * keeps its own default rather than resolving an empty string to the checkout.
 */
export function resolveConfiguredWorktreeRoot(
  configured: unknown,
  primaryCheckout: string,
  home: string = homedir(),
): string | null {
  const trimmed = String(configured ?? '').trim();
  if (!trimmed) return null;
  if (trimmed === '~') return path.resolve(home);
  if (/^~[\\/]/.test(trimmed)) return path.resolve(home, trimmed.slice(2));
  return path.resolve(primaryCheckout, trimmed);
}

/** `<data dir>/worktrees/<projectID>` — outside every checkout, keyed per repository. */
export function defaultWorktreeRoot(dataDir: string, projectId: string): string {
  return path.join(dataDir, 'worktrees', projectId);
}

/** `<slug>`, then `<slug>-<adjective>-<noun>` × attempts-1. */
export function worktreeNameCandidates(preferredName: string, attempts = WORKTREE_NAME_ATTEMPTS): string[] {
  const base = slugWorktreeName(preferredName);
  if (!base) {
    return Array.from({ length: attempts }, () => generateBranchSlug());
  }
  return Array.from({ length: attempts }, (_, index) =>
    index === 0 ? base : `${base}-${generateBranchSlug()}`,
  );
}

export interface ResolvedWorktreeTarget {
  name: string;
  directory: string;
  branch: string;
}

export interface ResolveTargetInput {
  root: string;
  preferredName: string;
  /** The dialog's branch, used verbatim and only the directory is checked. */
  explicitBranch?: string | null;
  /** The branch a generated candidate would get. */
  generatedBranch: (name: string) => string;
  branchExists: (branch: string) => Promise<boolean>;
}

/**
 * Pick a free name. A candidate is rejected when its directory exists OR — for a
 * generated branch — when the branch it would get already exists, so the folder
 * and the branch can never disagree about which one is "the name".
 */
export async function resolveTargetDirectory(input: ResolveTargetInput): Promise<ResolvedWorktreeTarget> {
  const explicit = input.explicitBranch?.trim() || null;
  for (const name of worktreeNameCandidates(input.preferredName)) {
    const directory = path.join(input.root, name);
    if (await pathExists(directory)) continue;
    if (explicit) return { name, directory, branch: explicit };
    const branch = input.generatedBranch(name);
    if (await input.branchExists(branch)) continue;
    return { name, directory, branch };
  }
  throw new Error('Failed to generate a unique worktree name');
}

/** A generated slug that collides with neither a folder nor a branch. */
export async function generateAvailableName(input: {
  root: string;
  branchExists: (branch: string) => Promise<boolean>;
  attempts?: number;
}): Promise<string> {
  const attempts = input.attempts ?? WORKTREE_NAME_ATTEMPTS;
  for (let index = 0; index < attempts; index += 1) {
    const slug = generateBranchSlug();
    if (await pathExists(path.join(input.root, slug))) continue;
    if (await input.branchExists(`${WORKTREE_BRANCH_PREFIX}/${slug}`)) continue;
    return slug;
  }
  throw new Error('Failed to generate a unique worktree name');
}