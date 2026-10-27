/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Source Control panel's mutating actions, as ONE dispatch table.
 *
 * The route was at the repo's 350-line ceiling with twenty inline branches;
 * this change adds a dozen more (the conflict trio, merge by branch, fetch,
 * amend, branch rename/delete, the stash). The handlers live in two domain
 * modules and are merged here, so `routes/fs/git.ts` keeps only the request
 * shape — root/repo resolution, the 400 envelope, the realtime signal — and
 * adding an action is a row rather than another `else if`.
 *
 *   - `git-actions-worktree.ts` — repository init, the index, the commit,
 *     checkout, branch creation, history/graph, and the commit-row actions
 *     (cherry-pick, revert, reset, rebase).
 *   - `git-actions-branch.ts` — merge, the conflict trio, fetch/push/pull/sync,
 *     branch rename/delete, the stash.
 */

import { GIT_WORKTREE_ACTIONS } from '@/server/lib/fs/git-actions-worktree';
import { GIT_BRANCH_ACTIONS } from '@/server/lib/fs/git-actions-branch';
import type { GitActionHandler } from '@/server/lib/fs/git-actions-shared';

export type { GitActionContext, GitActionHandler } from '@/server/lib/fs/git-actions-shared';

/**
 * Every action a client may dispatch, by its `actionType`.
 *
 * The two halves are spread in order; a name present in both would be the later
 * one, which is why the two tables are kept disjoint by domain rather than by
 * convenience.
 */
export const GIT_ACTIONS: Record<string, GitActionHandler> = {
  ...GIT_WORKTREE_ACTIONS,
  ...GIT_BRANCH_ACTIONS,
};
