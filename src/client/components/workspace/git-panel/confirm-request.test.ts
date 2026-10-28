/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The confirm-routing table: which actions ask first, and what each question
 * carries.
 *
 * The bug these pin is not the wording — it is the PAYLOAD. A confirm request
 * that carried the delete target as `file` (the shape every other confirming
 * action uses) sent an empty `branch` field, so the delete ran against nothing
 * and the row stayed put; and it dropped the force flag entirely, so the
 * dialog's "delete even if its commits are not merged" checkbox had no effect
 * and an unmerged branch was refused with the checkbox apparently doing
 * nothing.
 */

import { describe, expect, test } from 'bun:test';
import { confirmRequestFor } from '@/client/components/workspace/git-panel/confirm-request';

describe('confirmRequestFor', () => {
  test('an ordinary action runs without a question', () => {
    expect(confirmRequestFor('stage', 'a.txt', undefined, null)).toBeNull();
    expect(confirmRequestFor('checkout', undefined, { branch: 'x' }, null)).toBeNull();
    expect(confirmRequestFor('continue_operation', undefined, undefined, 'merge')).toBeNull();
  });

  test('the four destructive actions ask, and only those four', () => {
    expect(confirmRequestFor('revert', 'a.txt', undefined, null)).not.toBeNull();
    expect(confirmRequestFor('revert_all', undefined, undefined, null)).not.toBeNull();
    expect(confirmRequestFor('abort_operation', undefined, undefined, 'merge')).not.toBeNull();
    expect(confirmRequestFor('delete_branch', undefined, { branch: 'x' }, null)).not.toBeNull();
  });

  test('the abort question names the operation it will discard', () => {
    // "Abort?" alone does not say whether a merge, a rebase or a stash pop is
    // being thrown away — and those are very different amounts of work.
    expect(confirmRequestFor('abort_operation', undefined, undefined, 'merge')?.message).toContain('merge');
    expect(confirmRequestFor('abort_operation', undefined, undefined, 'rebase')?.message).toContain('rebase');
    expect(confirmRequestFor('abort_operation', undefined, undefined, 'stash-pop')?.message).toContain('stash pop');
  });

  test('the delete target travels as `branch`, the field the route reads', () => {
    const request = confirmRequestFor('delete_branch', undefined, { branch: 'feature/x' }, null);
    expect(request?.extra).toEqual({ branch: 'feature/x' });
    // NOT `file`: the route has no `file` field for this action, so a request
    // carrying it sent an empty branch name.
    expect(request?.file).toBeUndefined();
  });

  test('force travels with the delete, and only when asked', () => {
    const soft = confirmRequestFor('delete_branch', undefined, { branch: 'x' }, null);
    expect(soft?.extra).toEqual({ branch: 'x' });
    expect(soft?.message).not.toContain('even though');

    const forced = confirmRequestFor('delete_branch', undefined, { branch: 'x', force: '1' }, null);
    expect(forced?.extra).toEqual({ branch: 'x', force: '1' });
    // The wording changes too: a force delete loses commits and says so.
    expect(forced?.message).toContain('even though');
  });

  test('a stash drop asks; a stash apply or pop does not', () => {
    // A drop is the one stash verb that loses something the panel cannot get
    // back; apply and pop put the changes back first.
    expect(confirmRequestFor('stash_drop', undefined, { ref: 'stash@{0}' }, null)).not.toBeNull();
    expect(confirmRequestFor('stash_apply', undefined, { ref: 'stash@{0}' }, null)).toBeNull();
    expect(confirmRequestFor('stash_push', undefined, undefined, null)).toBeNull();
    // The ref travels, or the confirm would drop the wrong entry.
    expect(confirmRequestFor('stash_drop', undefined, { ref: 'stash@{2}' }, null)?.extra).toEqual({ ref: 'stash@{2}' });
  });
});
