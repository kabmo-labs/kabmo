/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Source Control panel's actions on OTHER refs and on an operation in
 * progress: merge, the conflict trio, fetch/push/pull/sync, branch
 * rename/delete, and the stash.
 *
 * Split from `git-actions-worktree.ts` (the index, the commit, checkout, branch
 * creation, history) for the repo's 350-line ceiling, and along the seam that
 * matters: everything here changes a ref the working tree is not on, or acts on
 * a merge/rebase/cherry-pick that is stopped.
 *
 * The conflict trio exists because a stopped operation is a STATE the panel
 * never modelled: measured, the commit box answered "Committing is not possible
 * because you have unmerged files", the discard button silently destroyed the
 * conflict while leaving `MERGE_HEAD` in place, and nothing on screen said a
 * merge was in progress.
 */

import { invalidateRemoteRefs, markRemoteRefsFresh } from '@/server/lib/fs/git-sync';
import { pullBranch, pushBranch } from '@/server/lib/fs/git-publish';
import { abortArgsFor, readGitState } from '@/server/lib/fs/git-state';
import { OPERATION_LABELS } from '@/shared/lib/fs/git-unmerged';
import { continueArgsFor, mergeBranch, resolveConflict, type ConflictSide } from '@/server/lib/fs/git-merge';
import { deleteBranch, renameBranch } from '@/server/lib/fs/git-branch';
import { applyStash, dropStash, pushStash } from '@/server/lib/fs/git-stash';
import { expectOk, field, fileForAction, flag, stoppedOperationPayload, type GitActionHandler } from '@/server/lib/fs/git-actions-shared';

/**
 * Refuse an action git will not accept while a conflict is unresolved.
 *
 * The panel offers these actions, so this is a guard against a stale client
 * rather than the primary UX — but the refusal has to name the reason, because
 * "you need to resolve your current index first" from git is what the user
 * would otherwise read on a Commit button.
 */
async function requireNoConflicts(targetDir: string, action: string): Promise<void> {
  const state = await readGitState(targetDir);
  if (state.conflicts.length > 0) {
    throw new Error(`${state.conflicts.length} conflicted file(s) must be resolved before ${action}.`);
  }
}

/** The branch/remote/conflict/stash actions. */
export const GIT_BRANCH_ACTIONS: Record<string, GitActionHandler> = {
  async merge_branch({ formData, targetDir }) {
    // By NAME, not by hash: `git merge <sha>` writes `Merge commit '<sha>'`
    // where `git merge <branch>` writes `Merge branch '<name>'` (measured).
    await mergeBranch(targetDir, field(formData, 'branch'));
    // A merge that stops on a conflict SUCCEEDS and leaves the tree to the
    // operation bar, so the panel's toast must not claim it merged.
    return stoppedOperationPayload(targetDir);
  },

  async abort_operation({ targetDir }) {
    const state = await readGitState(targetDir);
    if (!state.operation) throw new Error('No merge, rebase, cherry-pick or revert is in progress.');
    await expectOk(abortArgsFor(state.operation), targetDir, 60_000);
  },

  async continue_operation({ targetDir }) {
    const state = await readGitState(targetDir);
    if (!state.operation) throw new Error('No merge, rebase, cherry-pick or revert is in progress.');
    // `stash-pop` FIRST, before the conflict check: its conflicts are resolved
    // into the WORKING TREE with no sequencer to conclude, so "resolve your
    // conflicts" would be the wrong instruction — the answer is that there is
    // nothing to continue, and the changes are simply there.
    const args = continueArgsFor(state.operation);
    if (!args) {
      throw new Error(`Nothing to conclude — a ${OPERATION_LABELS[state.operation]} leaves its changes in the working tree.`);
    }
    await requireNoConflicts(targetDir, 'concluding the operation');
    await expectOk(args, targetDir, 60_000);
  },

  async resolve_conflict({ formData, targetDir }) {
    const side = field(formData, 'side');
    if (side && side !== 'ours' && side !== 'theirs') throw new Error(`Unknown conflict side: ${side}`);
    await resolveConflict({
      targetDir,
      file: fileForAction(formData, targetDir),
      side: (side || undefined) as ConflictSide | undefined,
    });
  },

  async fetch({ targetDir }) {
    // `--all --prune`: every remote, and the tracking refs a deleted remote
    // branch left behind. The TTL cache is reset so the next ahead/behind read
    // does not answer from the pre-fetch refs.
    await expectOk(['fetch', '--all', '--prune'], targetDir, 120_000);
    invalidateRemoteRefs(targetDir);
  },

  async push({ targetDir }) {
    await pushBranch(targetDir);
    markRemoteRefsFresh(targetDir);
  },

  async pull({ targetDir }) {
    await pullBranch(targetDir);
    markRemoteRefsFresh(targetDir);
    // `pullBranch` stands down on a branch with no upstream (nothing to pull is
    // not a failure) and accepts a merge that stopped on a conflict — the
    // second leaves the tree to the operation bar, and the toast says so.
    return stoppedOperationPayload(targetDir);
  },

  async sync({ targetDir }) {
    // A merge/rebase already stopped on a conflict is a state the operation
    // bar owns: a pull there is refused by git ("You have not concluded your
    // merge"), and letting that refusal through would report the conflict as
    // a failed sync. Naming it points the user at the bar instead.
    const before = await readGitState(targetDir);
    if (before.operation) {
      throw new Error(
        `Finish the ${OPERATION_LABELS[before.operation]} first — Sync is unavailable while an operation is in progress.`,
      );
    }
    await pullBranch(targetDir);
    // A pull that stopped on a conflict has nothing to push yet: the merge is
    // unresolved, so `git push` refuses ("Updates were rejected because the
    // remote contains work…") and the route would report a failed Sync over a
    // conflict the panel is about to offer to resolve. The operation bar is
    // the surface that has to be reached, so the push is skipped and the
    // working tree is left exactly as the pull left it — and the answer says
    // which operation is now waiting, because nothing was pushed.
    const after = await readGitState(targetDir);
    if (!after.operation) await pushBranch(targetDir);
    // Both commands already moved the tracking ref; the next read must not
    // fetch again to see a state it just produced.
    markRemoteRefsFresh(targetDir);
    return after.operation ? { success: true, stopped: after.operation } : undefined;
  },

  async rename_branch({ formData, targetDir }) {
    await renameBranch({
      targetDir,
      from: field(formData, 'branch'),
      to: field(formData, 'newName'),
      remote: flag(formData, 'remote'),
    });
  },

  async delete_branch({ formData, targetDir }) {
    await deleteBranch({
      targetDir,
      name: field(formData, 'branch'),
      force: flag(formData, 'force'),
    });
  },

  async stash_push({ formData, targetDir }) {
    await pushStash({
      targetDir,
      message: field(formData, 'message'),
      includeUntracked: flag(formData, 'untracked'),
    });
  },

  async stash_apply({ formData, targetDir }) {
    await applyStash({
      targetDir,
      ref: field(formData, 'ref') || 'stash@{0}',
      pop: flag(formData, 'pop'),
    });
    // A conflicting `git stash pop` leaves its conflicts in the working tree
    // with no operation file at all (`stash-pop`), so the toast must not claim
    // the stash was popped cleanly.
    return stoppedOperationPayload(targetDir);
  },

  async stash_drop({ formData, targetDir }) {
    await dropStash(targetDir, field(formData, 'ref'));
  },
};
