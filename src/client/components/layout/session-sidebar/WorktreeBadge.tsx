/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The `⑂ wt/branch` chip under a worktree session's title.
 *
 * It is a LABEL, not a control: the row's own click opens the chat, and the
 * project's panels already follow the session's root, so a second click target
 * here would only be a way to open the same thing twice. The absolute path lives
 * in `title`, which is where a reader looks when they want to know where the
 * chat actually writes.
 *
 * `missing` is the one state that changes the wording rather than the colour
 * alone: a worktree whose directory was removed outside Kabmo keeps its row (so
 * its transcript is reachable) but must not read as an ordinary checkout.
 */

import type { SessionWorktreeInfo } from '@/shared/lib/workspace/worktree/types';

export const WORKTREE_BADGE_MISSING_SUFFIX = 'missing';

/** What the chip says, without the markup — exported so a test asserts the words. */
export function worktreeBadgeLabel(worktree: SessionWorktreeInfo): string {
  const name = worktree.branch || (worktree.detached ? 'detached' : 'worktree');
  return worktree.status === 'missing' ? `${name} · ${WORKTREE_BADGE_MISSING_SUFFIX}` : name;
}

export function worktreeBadgeTitle(worktree: SessionWorktreeInfo): string {
  if (worktree.status === 'missing') {
    return `Worktree folder is missing: ${worktree.path}`;
  }
  return worktree.detached
    ? `Detached HEAD in worktree ${worktree.path}`
    : `Runs in worktree ${worktree.path}`;
}

export function WorktreeBadge({ worktree }: { worktree: SessionWorktreeInfo }) {
  const missing = worktree.status === 'missing';
  return (
    <span
      className={`flex min-w-0 items-center gap-1 truncate text-[10px] font-normal ${
        missing ? 'text-warning' : 'text-ink/45'
      }`}
      title={worktreeBadgeTitle(worktree)}
      data-worktree-status={worktree.status}
    >
      <span aria-hidden="true" className="shrink-0 font-mono">
        ⑂
      </span>
      <span className="truncate">{worktreeBadgeLabel(worktree)}</span>
    </span>
  );
}