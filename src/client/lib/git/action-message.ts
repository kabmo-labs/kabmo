/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The sentence the Source Control panel toasts after an accepted action.
 *
 * A table, not a `switch` at the call site, and one that returns `null` on
 * purpose. **An action whose result is already on screen stays silent**: the
 * change list IS the feedback for a stage, an unstage, a discard or a resolved
 * conflict, and a toast per row would turn a five-file stage into five popups.
 *
 * The actions that DO speak are the ones the list cannot show:
 *
 *  - `push`/`pull`/`fetch`/`sync`, whose effect is on the REMOTE — the working
 *    tree above is byte-identical afterwards, so nothing on screen moves.
 *  - a branch or ref move (`checkout`, `create_branch`, `merge`, `rebase`,
 *    `reset`, `cherry-pick`, `revert`), where the list is the same files on a
 *    different base.
 *  - `commit`, because the box clears and the files leave "Staged" with no
 *    sentence saying the commit landed.
 *  - the stash, which folds a section shut and leaves a list that looks the
 *    same as before.
 *
 * The wording names WHAT the user acted on — the branch, the commit, the stash
 * ref — from the fields the panel dispatched: "Operation succeeded" over a panel
 * with eleven verbs is a toast the reader has to reconstruct.
 *
 * **A stopped operation has its own sentence.** `git merge`, `cherry-pick`,
 * `revert`, `rebase` and `git pull` exit successfully while leaving an
 * operation in progress, and `git stash pop` leaves conflicts with no operation
 * file at all. The server reports which one (`stopped`), and reporting "Merged
 * feature" over a merge that stopped on a conflict is the panel claiming an
 * outcome git did not produce.
 */

import { OPERATION_LABELS } from '@/shared/lib/fs/git-unmerged';

export interface GitActionMessageInput {
  actionType: string;
  /** The fields the panel dispatched with the action. */
  extra?: Record<string, string>;
  /**
   * The operation the action STOPPED on, as the server read it back.
   *
   * Only the verbs that can leave one report it, and a `sync` that stopped is a
   * pull whose push never ran.
   */
  stopped?: string | null;
}

/** The two sentences a verb can have: what it did, and what it started. */
interface Phrases {
  done: string;
  /** The wording while an operation is left in progress; absent = cannot stop. */
  stopped?: string;
}

/** Longest commit subject a toast carries on one line. */
const MAX_SUBJECT = 48;

/** The sentence a completed action gets, or `null` for the silent verbs. */
function phrasesFor(actionType: string, extra: Record<string, string> | undefined): Phrases | null {
  const branch = extra?.branch?.trim() ?? '';
  const hash = (extra?.hash ?? '').slice(0, 7);
  const ref = extra?.ref?.trim() || 'stash@{0}';

  switch (actionType) {
    case 'init':
      return { done: 'Initialized the repository' };
    case 'fetch':
      return { done: 'Fetched every remote' };
    case 'push':
      return { done: 'Pushed to upstream' };
    case 'pull':
      return { done: 'Pulled from upstream', stopped: 'Pulled' };
    case 'sync':
      return { done: 'Synced with upstream', stopped: 'Pulled, but nothing was pushed' };
    case 'abort_operation':
      return { done: 'Aborted the operation in progress' };
    case 'continue_operation':
      return { done: 'Concluded the operation' };
    case 'commit': {
      if (extra?.amend === '1') return { done: 'Amended the last commit' };
      const subject = (extra?.message ?? '').split('\n')[0].trim();
      if (!subject) return { done: 'Commit created' };
      const shown = subject.length > MAX_SUBJECT ? `${subject.slice(0, MAX_SUBJECT - 1)}…` : subject;
      return { done: `Committed “${shown}”` };
    }
    case 'checkout':
      return { done: branch ? `Switched to ${branch}` : 'Switched branch' };
    case 'create_branch':
    case 'create_branch_at':
      return { done: branch ? `Created branch ${branch}` : 'Created branch' };
    case 'rename_branch': {
      const to = extra?.newName?.trim() ?? '';
      return { done: branch && to ? `Renamed ${branch} to ${to}` : 'Renamed branch' };
    }
    case 'delete_branch':
      return { done: branch ? `Deleted branch ${branch}` : 'Deleted branch' };
    case 'merge_branch':
      return {
        done: branch ? `Merged ${branch}` : 'Merged branch',
        stopped: branch ? `Merging ${branch}` : 'Merging the branch',
      };
    case 'merge_commit':
      return {
        done: hash ? `Merged commit ${hash}` : 'Merged commit',
        stopped: hash ? `Merging ${hash}` : 'Merging the commit',
      };
    case 'cherry_pick':
      return {
        done: hash ? `Cherry-picked ${hash}` : 'Cherry-picked commit',
        stopped: hash ? `Cherry-picking ${hash}` : 'Cherry-picking the commit',
      };
    case 'revert_commit':
      return {
        done: hash ? `Reverted commit ${hash}` : 'Reverted commit',
        stopped: hash ? `Reverting ${hash}` : 'Reverting the commit',
      };
    case 'rebase_commit':
      return {
        done: hash ? `Rebased onto ${hash}` : 'Rebased',
        stopped: hash ? `Rebasing onto ${hash}` : 'Rebasing',
      };
    case 'reset_commit': {
      const mode = extra?.mode ?? 'mixed';
      return { done: hash ? `Reset to ${hash} (${mode})` : `Reset (${mode})` };
    }
    case 'stash_push':
      return { done: 'Stashed your changes' };
    case 'stash_apply':
      return {
        done: extra?.pop === '1' ? `Popped ${ref}` : `Applied ${ref}`,
        stopped: extra?.pop === '1' ? `Popping ${ref}` : `Applying ${ref}`,
      };
    case 'stash_drop':
      return { done: `Dropped ${ref}` };
    default:
      // stage/unstage/revert/resolve_conflict/history/graph/… — the list and
      // the modals are their feedback, and a toast would only be noise.
      return null;
  }
}

/** The toast for an accepted action, or `null` when the panel stays silent. */
export function gitActionSuccessMessage({ actionType, extra, stopped }: GitActionMessageInput): string | null {
  const phrases = phrasesFor(actionType, extra);
  if (!stopped) return phrases?.done ?? null;

  const label = (OPERATION_LABELS as Record<string, string>)[stopped] ?? stopped;
  const head = phrases?.stopped ?? phrases?.done ?? '';
  // A stopped Sync has not pushed, so its own sentence already says so; the
  // instruction differs because the answer is to Sync again once it concludes.
  const resolve = actionType === 'sync' ? 'resolve it above, then Sync again' : 'resolve it above';
  return head
    ? `${head} — the ${label} stopped on a conflict; ${resolve}`
    : `The ${label} stopped on a conflict; ${resolve}`;
}
