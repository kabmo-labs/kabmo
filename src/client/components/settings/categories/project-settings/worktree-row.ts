/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One worktree row's second line, and the words the delete control uses.
 *
 * Split from the component because these are the sentences a reader decides on:
 * "which branch is held here" (and therefore cannot be checked out anywhere
 * else), "how many chats start here", and "is it safe to delete". A markup test
 * would prove the component renders *something*; these functions are what it has
 * to say.
 */

import type { WorktreeInfo } from '@/shared/lib/workspace/worktree/types';

/** What a row says under its branch. */
export function worktreeRowDetail(worktree: WorktreeInfo): string {
  if (worktree.missing) return 'folder is missing — its chats still open';
  const branch = worktree.detached
    ? `detached @ ${worktree.head.slice(0, 7) || 'unknown'}`
    : `${worktree.branch} checked out here`;
  const sessions = worktree.sessions === 1 ? '1 chat' : `${worktree.sessions} chats`;
  const changes = worktree.dirty === 0 ? 'clean' : `${worktree.dirty} changed`;
  return `${branch} · ${sessions} · ${changes}`;
}

/**
 * Whether the branch may be deleted along with the worktree.
 *
 * `git branch -d` refuses a branch with commits of its own, so the checkbox is
 * offered only when there is nothing to lose — a control that can only be
 * refused is worse than one that is disabled with the reason beside it.
 */
export function branchDeletable(worktree: WorktreeInfo): boolean {
  return !worktree.detached && Boolean(worktree.branch) && worktree.aheadOfStart === 0;
}

/** Why the remove control is refused, or null when it may run. */
export function removalRefusal(worktree: WorktreeInfo): string | null {
  if (worktree.isPrimary) return 'The main checkout cannot be removed.';
  if (worktree.dirty > 0) {
    return `${worktree.dirty} uncommitted file${worktree.dirty === 1 ? '' : 's'} here would be lost.`;
  }
  return null;
}