/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The working-tree and history half of the Source Control panel's actions: the
 * index, the commit, checkout, branch creation, and the two read actions that
 * travel through the POST path (a page of commits, one file's patch).
 *
 * The branch/remote/conflict/stash half is `git-actions-branch.ts`; both are
 * merged into one dispatch table by `git-actions.ts`. Split for the repo's
 * 350-line ceiling, and along the seam that matters: everything here acts on
 * the working tree or the current branch, everything there acts on OTHER refs
 * or on an operation in progress.
 *
 * Every handler runs git as ARGV, never a shell string, and every operand a
 * client supplies is either validated against git itself (`check-ref-format`, a
 * hash shape) or separated with `--`. That is not ceremony: the route's own
 * header records that a commit message of ``fix `touch /tmp/PWN` thing``
 * executed the substitution, and measured for this change, `git merge --abort`
 * ran happily when the "hash" was `--abort`.
 */

import { invalidateRemoteRefs } from '@/server/lib/fs/git-sync';
import { readGitState } from '@/server/lib/fs/git-state';
import { revertAll, revertPath } from '@/server/lib/fs/git-revert';
import {
  cherryPick,
  mergeCommit,
  rebaseOnto,
  resetTo,
  revertCommit,
} from '@/server/lib/fs/git-merge';
import { fetchCommitsPage, fetchDiffActions } from '@/server/lib/fs/git-actions-history';
import { expectOk, field, fileForAction, hashFor, refExists, type GitActionHandler } from '@/server/lib/fs/git-actions-shared';

/**
 * Checkout a branch, a remote-tracking ref or a commit.
 *
 * Order matters, and `git rev-parse --verify <x>^{commit}` is NOT a
 * discriminator: it resolves for a remote-tracking ref too, so it matched
 * `origin/feature` and detached instead of creating the local branch
 * (verified). A commit is what the commit modal's "checkout" names, and it
 * sends the full `%H`, so the SHAPE is what identifies it.
 *
 * The last branch runs `git checkout -b <name> --track <ref>` and the `--`
 * separator is deliberately NOT used there: measured, `git checkout -b feature
 * -- origin/feature` fails with "'origin/feature' is not a commit and a branch
 * 'feature' cannot be created from it" — the separator makes git read the ref
 * as a pathspec. The argv hole is closed by the resolve check instead: a ref
 * that does not resolve as a commit never reaches the command, so `--abort`
 * cannot be read as an option.
 */
async function checkoutRef(targetDir: string, ref: string): Promise<void> {
  const localName = ref.split('/').slice(1).join('/');
  if (await refExists(`refs/heads/${ref}`, targetDir)) {
    await expectOk(['checkout', ref], targetDir);
  } else if (localName && (await refExists(`refs/heads/${localName}`, targetDir))) {
    await expectOk(['checkout', localName], targetDir);
  } else if (/^[0-9a-f]{7,40}$/i.test(ref) && (await refExists(`${ref}^{commit}`, targetDir))) {
    // A detached checkout is what the request means: `-b <name> --track <sha>`
    // refuses with "starting point '<sha>' is not a branch".
    await expectOk(['checkout', '--detach', ref], targetDir);
  } else if (localName && (await refExists(`${ref}^{commit}`, targetDir))) {
    // A remote-tracking ref: create the local branch and track it. The resolve
    // check above is what keeps a non-ref out of argv.
    await expectOk(['checkout', '-b', localName, '--track', ref], targetDir);
  } else {
    throw new Error(`'${ref}' is not a branch or a commit in this repository.`);
  }
  // The counts are per-branch: the refs the previous branch refreshed say
  // nothing about the new one's upstream.
  invalidateRemoteRefs(targetDir);
}

/** The working-tree and history actions. */
export const GIT_WORKTREE_ACTIONS: Record<string, GitActionHandler> = {
  async commit({ formData, targetDir }) {
    const message = (formData.get('message') as string) ?? '';
    const amend = formData.get('amend') === '1';
    // argv, never `git commit -m "<message>"`: a message holding a backtick or
    // a `$( )` was executed by the shell the old command string went through.
    // `--amend` rewrites the previous commit, which is why the panel asks for it
    // explicitly and never implies it.
    await expectOk(amend ? ['commit', '--amend', '-m', message] : ['commit', '-m', message], targetDir);
  },

  async stage({ formData, targetDir }) {
    await expectOk(['add', '--', fileForAction(formData, targetDir)], targetDir);
  },

  async stage_all({ targetDir }) {
    await expectOk(['add', '-A'], targetDir);
  },

  async unstage({ formData, targetDir }) {
    // `git reset`, not `git restore --staged`: the latter resolves HEAD and
    // fails outright in a repository that has no commits yet ("could not
    // resolve 'HEAD'"), which is exactly where a first commit is staged.
    await expectOk(['reset', '-q', '--', fileForAction(formData, targetDir)], targetDir);
  },

  async unstage_all({ targetDir }) {
    await expectOk(['reset', '-q'], targetDir);
  },

  async revert({ formData, targetDir }) {
    const file = fileForAction(formData, targetDir);
    // The conflict list is read here so a discard cannot destroy a conflict:
    // measured, the three-step revert succeeded on a `UU` path, threw the
    // conflict away and left MERGE_HEAD in place.
    const state = await readGitState(targetDir);
    await revertPath({ targetDir, file, conflicts: state.conflicts });
  },

  async revert_all({ targetDir }) {
    // `git checkout -- .` on an unmerged index refuses, but the `clean -fd`
    // after it does not — and the pair is offered as one button, so the guard
    // is the conflict list rather than git's own refusal.
    const state = await readGitState(targetDir);
    if (state.conflicts.length > 0) {
      throw new Error(`${state.conflicts.length} conflicted file(s) must be resolved before discarding all changes.`);
    }
    await revertAll(targetDir);
  },

  async checkout({ formData, targetDir }) {
    await checkoutRef(targetDir, field(formData, 'branch'));
  },

  async create_branch({ formData, targetDir }) {
    const branch = field(formData, 'branch');
    // The toolbar's "Create new branch" flow: create AND switch, which is what
    // a user who just named a branch expects to be on.
    await expectOk(['checkout', '-b', branch], targetDir);
    invalidateRemoteRefs(targetDir);
  },

  async create_branch_at({ formData, targetDir }) {
    const branch = field(formData, 'branch');
    const startPoint = field(formData, 'hash');
    // The commit modal's "create branch here": create the ref at that commit
    // and STAY PUT. `git checkout -b <name> <sha>` was both the wrong verb and
    // a failure waiting to happen — it switches the working tree, so a dirty
    // repository answered "Your local changes to the following files would be
    // overwritten by checkout … Aborting" and no branch was created at all.
    await expectOk(startPoint ? ['branch', branch, startPoint] : ['branch', branch], targetDir);
  },

  async history({ formData, targetDir }) {
    return fetchCommitsPage(targetDir, 'history', formData);
  },

  async graph({ formData, targetDir }) {
    return fetchCommitsPage(targetDir, 'graph', formData);
  },

  async commit_diff({ formData, targetDir }) {
    return fetchDiffActions(targetDir, 'commit_diff', formData);
  },

  async file_diff({ formData, targetDir }) {
    return fetchDiffActions(targetDir, 'file_diff', formData);
  },

  async merge_commit({ formData, targetDir }) {
    await mergeCommit(targetDir, hashFor(formData));
  },

  async cherry_pick({ formData, targetDir }) {
    await cherryPick(targetDir, hashFor(formData));
  },

  async revert_commit({ formData, targetDir }) {
    await revertCommit(targetDir, hashFor(formData));
  },

  async reset_commit({ formData, targetDir }) {
    const mode = (field(formData, 'mode') || 'soft').toLowerCase();
    await resetTo(targetDir, hashFor(formData), mode);
  },

  async rebase_commit({ formData, targetDir }) {
    await rebaseOnto(targetDir, hashFor(formData));
  },
};
