/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Source Control panel's toast wording.
 *
 * Three rules are pinned here, and each is a sentence the user reads:
 *
 * - **A stopped operation never claims its verb's outcome.** `git merge`,
 *   `cherry-pick`, `revert`, `rebase`, `pull` and `stash pop` all SUCCEED while
 *   leaving the tree to the operation bar; "Merged feature" over a merge that
 *   stopped on a conflict is the panel reporting an outcome git did not
 *   produce. A stopped Sync is the sharpest case: the pull ran and the push
 *   did not.
 * - **The silent verbs stay silent.** The change list is the answer for a
 *   stage, an unstage, a discard or a resolved conflict, so a toast per row
 *   would turn a five-file stage into five popups.
 * - **The sentence names what the user acted on** — the branch, the commit
 *   subject, the stash ref — from the fields the panel dispatched.
 */

import { describe, expect, test } from 'bun:test';
import { gitActionSuccessMessage } from '@/client/lib/git/action-message';

describe('gitActionSuccessMessage', () => {
  test('names the remote verbs', () => {
    expect(gitActionSuccessMessage({ actionType: 'sync' })).toBe('Synced with upstream');
    expect(gitActionSuccessMessage({ actionType: 'push' })).toBe('Pushed to upstream');
    expect(gitActionSuccessMessage({ actionType: 'pull' })).toBe('Pulled from upstream');
    expect(gitActionSuccessMessage({ actionType: 'fetch' })).toBe('Fetched every remote');
  });

  test('a commit carries its subject, and an amend says it rewrote one', () => {
    expect(gitActionSuccessMessage({ actionType: 'commit', extra: { message: 'fix(git): toast\n\nbody' } }))
      .toBe('Committed “fix(git): toast”');
    expect(gitActionSuccessMessage({ actionType: 'commit', extra: { message: 'x', amend: '1' } }))
      .toBe('Amended the last commit');
  });

  test('a long subject is shortened, never wrapped', () => {
    const subject = 'a'.repeat(80);
    const message = gitActionSuccessMessage({ actionType: 'commit', extra: { message: subject } }) ?? '';
    expect(message).toBe(`Committed “${'a'.repeat(47)}…”`);
  });

  test('names the branch, the commit and the stash ref the panel dispatched', () => {
    expect(gitActionSuccessMessage({ actionType: 'checkout', extra: { branch: 'feat/x' } })).toBe('Switched to feat/x');
    expect(gitActionSuccessMessage({ actionType: 'delete_branch', extra: { branch: 'feat/x' } })).toBe('Deleted branch feat/x');
    expect(gitActionSuccessMessage({ actionType: 'rename_branch', extra: { branch: 'a', newName: 'b' } }))
      .toBe('Renamed a to b');
    expect(gitActionSuccessMessage({ actionType: 'cherry_pick', extra: { hash: '0123456789abcdef' } }))
      .toBe('Cherry-picked 0123456');
    expect(gitActionSuccessMessage({ actionType: 'stash_apply', extra: { ref: 'stash@{2}', pop: '1' } }))
      .toBe('Popped stash@{2}');
    expect(gitActionSuccessMessage({ actionType: 'stash_apply', extra: {} })).toBe('Applied stash@{0}');
  });

  test('a stopped operation is reported as started, never as finished', () => {
    expect(gitActionSuccessMessage({ actionType: 'merge_branch', extra: { branch: 'feat' }, stopped: 'merge' }))
      .toBe('Merging feat — the merge stopped on a conflict; resolve it above');
    expect(gitActionSuccessMessage({ actionType: 'sync', stopped: 'merge' }))
      .toBe('Pulled, but nothing was pushed — the merge stopped on a conflict; resolve it above, then Sync again');
    expect(gitActionSuccessMessage({ actionType: 'pull', stopped: 'rebase' }))
      .toBe('Pulled — the rebase stopped on a conflict; resolve it above');
    expect(gitActionSuccessMessage({ actionType: 'stash_apply', extra: { pop: '1' }, stopped: 'stash-pop' }))
      .toBe('Popping stash@{0} — the stash pop stopped on a conflict; resolve it above');
  });

  test('the change-list verbs stay silent', () => {
    for (const actionType of ['stage', 'stage_all', 'unstage', 'unstage_all', 'revert', 'revert_all', 'resolve_conflict']) {
      expect(gitActionSuccessMessage({ actionType })).toBeNull();
    }
  });

  test('the read actions never toast — the modal is their answer', () => {
    expect(gitActionSuccessMessage({ actionType: 'history' })).toBeNull();
    expect(gitActionSuccessMessage({ actionType: 'graph' })).toBeNull();
    expect(gitActionSuccessMessage({ actionType: 'commit_diff' })).toBeNull();
  });
});
