/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Repository identity — the key a repository's worktrees live under.
 *
 * The derivation is OpenChamber's (`git rev-list --max-parents=0 --all`, sorted,
 * first line: the root commit), and two clones of one repository share it.
 *
 * It is NOT stable on its own, which is why they cache it in
 * `<primary>/.git/opencode`. Measured: adding a branch with unrelated history
 * (`git checkout --orphan`) inserts a second root and MOVES the sorted-first
 * value, so a repository that gained one would look for its worktrees in a
 * different folder. Kabmo does not write into a user's `.git`, so the stored row
 * is the cache and it always wins.
 */

import { runGit } from '@/server/lib/fs/git-run';

/** `rev-list --max-parents=0 --all`, sorted, first. `null` for an unborn branch. */
export async function deriveProjectId(primaryRoot: string): Promise<string | null> {
  const listed = await runGit(['rev-list', '--max-parents=0', '--all'], {
    cwd: primaryRoot,
    maxBuffer: 1024 * 1024,
  });
  if (listed.exitCode !== 0) return null;
  const roots = listed.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  return roots[0] ?? null;
}

/**
 * The identity to key this repository's worktrees under.
 *
 * A stored value beats the derivation — that is the whole point of keeping one.
 * Only a repository with no record derives, which is the moment it has no
 * worktree folder to protect.
 */
export async function resolveProjectId(
  primaryRoot: string,
  identityFor: (primaryRoot: string) => Promise<string | null>,
): Promise<string> {
  const stored = await identityFor(primaryRoot);
  if (stored) return stored;
  const derived = await deriveProjectId(primaryRoot);
  if (!derived) throw new Error('This repository has no commits yet.');
  return derived;
}