/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The verb tables for a stopped operation: which command CONCLUDES it and which
 * ABORTS it.
 *
 * These two mappings are the fix for the bugs that made a stopped operation a
 * dead end, and each entry is a measurement rather than a preference:
 *
 *  - **`git commit --no-edit` only concludes a MERGE.** On a resolved rebase
 *    conflict it makes the commit and leaves `rebase-merge` behind — measured,
 *    `git status` then reads "interactive rebase in progress" and the panel's
 *    operation bar would never clear. Cherry-pick and revert have the same
 *    shape, each with its own `--continue`.
 *  - **`stash-pop` has no verb at all.** A conflicting `stash pop` leaves
 *    unmerged entries and NO operation file, so every `--abort` exits 128 with
 *    its own fatal; only `reset --merge HEAD` clears it (and it keeps the stash
 *    entry, which is what makes the retry possible).
 *
 * A table test rather than one assertion per branch: the SET is the contract,
 * and a new operation must be given both answers or the test fails.
 */

import { describe, expect, test } from 'bun:test';
import { abortArgsFor, OPERATION_PATHS } from '@/server/lib/fs/git-state';
import { continueArgsFor } from '@/server/lib/fs/git-merge';
import type { GitOperation } from '@/shared/types';

/** Every operation the state read can report, as the file map declares them. */
const ALL_OPERATIONS: GitOperation[] = ['merge', 'rebase', 'rebase-apply', 'cherry-pick', 'revert', 'stash-pop'];

describe('continueArgsFor', () => {
  test('a merge is concluded by a commit, not by `merge --continue`', () => {
    // Both finish a merge, but `--continue` needs an editor for the message it
    // prepared and there is no terminal to draw one in; `--no-edit` needs none.
    expect(continueArgsFor('merge')).toEqual(['commit', '--no-edit']);
  });

  test('each sequencer gets its OWN --continue', () => {
    // The bug this pins: `commit --no-edit` on a rebase makes the commit and
    // leaves the rebase RUNNING, so the bar never clears.
    expect(continueArgsFor('rebase')).toEqual(['rebase', '--continue']);
    expect(continueArgsFor('rebase-apply')).toEqual(['rebase', '--continue']);
    expect(continueArgsFor('cherry-pick')).toEqual(['cherry-pick', '--continue']);
    expect(continueArgsFor('revert')).toEqual(['revert', '--continue']);
  });

  test('a stash pop has NOTHING to conclude', () => {
    // Its changes are in the working tree with no sequencer to finish; a commit
    // here would create one the user never asked for. `null` is what makes the
    // route refuse and the bar hide the button.
    expect(continueArgsFor('stash-pop')).toBeNull();
  });

  test('every operation has an answer — null or a verb, never a fallthrough', () => {
    for (const operation of ALL_OPERATIONS) {
      const args = continueArgsFor(operation);
      if (args !== null) {
        expect(Array.isArray(args)).toBe(true);
        expect(args.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('abortArgsFor', () => {
  test('each operation aborts with its own verb', () => {
    expect(abortArgsFor('merge')).toEqual(['merge', '--abort']);
    expect(abortArgsFor('rebase')).toEqual(['rebase', '--abort']);
    expect(abortArgsFor('rebase-apply')).toEqual(['rebase', '--abort']);
    expect(abortArgsFor('cherry-pick')).toEqual(['cherry-pick', '--abort']);
    expect(abortArgsFor('revert')).toEqual(['revert', '--abort']);
  });

  test('a stash pop aborts by RESET, because no --abort verb exists for it', () => {
    // Measured: with unmerged entries and no operation file, `merge --abort`,
    // `rebase --abort` and `cherry-pick --abort` each exit 128 with its own
    // fatal. `reset --merge HEAD` clears the conflict and keeps the stash entry.
    expect(abortArgsFor('stash-pop')).toEqual(['reset', '--merge', 'HEAD']);
  });

  test('every operation has an abort — a stopped operation is never a dead end', () => {
    for (const operation of ALL_OPERATIONS) {
      const args = abortArgsFor(operation);
      expect(args.length).toBeGreaterThan(0);
      // Never the same verb as continue: an abort that concluded would be
      // indistinguishable from pressing the other button.
      expect(args).not.toEqual(continueArgsFor(operation));
    }
  });
});

describe('OPERATION_PATHS', () => {
  test('maps each state FILE to the operation it means', () => {
    const byName = Object.fromEntries(OPERATION_PATHS.map((p) => [p.name, p.operation]));
    expect(byName).toEqual({
      MERGE_HEAD: 'merge',
      'rebase-merge': 'rebase',
      'rebase-apply': 'rebase-apply',
      CHERRY_PICK_HEAD: 'cherry-pick',
      REVERT_HEAD: 'revert',
    });
  });

  test('every operation except stash-pop is a file-backed state', () => {
    // `stash-pop` is the one with NO file — that absence is what makes it a
    // distinct operation rather than a null, so it must not appear here.
    const backed = new Set(OPERATION_PATHS.map((p) => p.operation));
    for (const operation of ALL_OPERATIONS) {
      if (operation === 'stash-pop') expect(backed.has(operation)).toBe(false);
      else expect(backed.has(operation)).toBe(true);
    }
  });
});
