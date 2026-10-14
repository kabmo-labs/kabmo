import type { GitOperation } from '@/shared/types/git';
import { OPERATION_LABELS } from '@/shared/lib/fs/git-unmerged';

/** The confirm dialog's shape, as `ConfirmActionModal` renders it. */
export interface ConfirmRequest {
  type: string;
  file?: string;
  /**
   * The extra form fields the action needs.
   *
   * `file` is not enough: `delete_branch` reads its target from the `branch`
   * field, so a confirm that only carried `file` ran the action with an EMPTY
   * branch name — measured in the browser, the dialog closed, the toast said
   * nothing, and the branch was still there. The confirm request therefore
   * carries the same fields the direct path would have sent.
   */
  extra?: Record<string, string>;
  message: string;
}

/**
 * The action types that ask before running, and the question each one asks.
 *
 * A table rather than a chain of `if`s at the call site, because the SET is the
 * policy: these four are the actions that cannot be undone from the panel — a
 * discard, a discard-all, aborting an operation (which throws away every
 * conflict resolved so far), and deleting a branch (whose only undo is the
 * reflog). Everything else runs immediately; a confirm on every action is a
 * confirm on none.
 *
 * `null` means "run it".
 */
export function confirmRequestFor(
  actionType: string,
  file: string | undefined,
  extra: Record<string, string> | undefined,
  operation: GitOperation | null,
): ConfirmRequest | null {
  if (actionType === 'revert') {
    return { type: actionType, file, message: `Are you sure you want to discard changes in ${file}?` };
  }

  if (actionType === 'revert_all') {
    return {
      type: actionType,
      message: 'Are you sure you want to discard ALL unstaged changes? This cannot be undone.',
    };
  }

  if (actionType === 'abort_operation') {
    // The operation's own name, because "abort" alone does not say whether the
    // user is throwing away a merge, a rebase or a stash pop — and the second
    // and third are very different amounts of work.
    const label = operation ? OPERATION_LABELS[operation] : 'operation';
    return {
      type: actionType,
      message: `Abort the ${label}? Everything resolved so far is discarded and the working tree returns to its pre-${label} state.`,
    };
  }

  if (actionType === 'delete_branch') {
    const name = extra?.branch ?? '';
    const force = extra?.force === '1';
    // The target travels as the `branch` field — that is the name the route
    // reads. Passing it as `file` (the previous shape) sent an empty branch and
    // the delete ran against nothing. `force` travels with it, or the dialog's
    // "delete even if its commits are not merged" checkbox had no effect: the
    // confirm path dropped it and the delete ran `-d` every time.
    return {
      type: actionType,
      extra: { branch: name, ...(force ? { force: '1' } : {}) },
      message: force
        ? `Delete branch ${name} even though its commits are not merged? This cannot be undone from the panel.`
        : `Delete branch ${name}?`,
    };
  }

  if (actionType === 'stash_drop') {
    const ref = extra?.ref || 'the top entry';
    // Same rule as a discard or a branch delete: the entry is gone and the panel
    // offers no way back (recovering it means knowing the stash's commit and
    // running `git stash store` by hand). `stash_apply`/`pop` are NOT confirmed —
    // they apply first, so nothing is lost.
    return {
      type: actionType,
      extra: { ref: extra?.ref ?? '' },
      message: `Drop ${ref}? The stash entry is removed — this cannot be undone from the panel.`,
    };
  }

  return null;
}
