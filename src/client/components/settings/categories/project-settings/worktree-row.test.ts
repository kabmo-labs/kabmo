/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What a worktree row says, and when its Remove control is refused.
 *
 * These are the sentences a reader decides on, so they are functions rather than
 * inline template strings: a markup test would prove the component renders
 * *something*, while the questions here are "which branch is held" (and therefore
 * cannot be checked out anywhere else), "how many chats start here", and "would
 * this removal lose work".
 */

import { describe, expect, test } from 'bun:test';
import {
  branchDeletable,
  removalRefusal,
  worktreeRowDetail,
} from '@/client/components/settings/categories/project-settings/worktree-row';
import type { WorktreeInfo } from '@/shared/lib/workspace/worktree/types';

const base: WorktreeInfo = {
  path: '/data/worktrees/abc/cosmic-dolphin',
  branch: 'wt/cosmic-dolphin',
  head: 'a1b2c3d4e5f6',
  detached: false,
  missing: false,
  isPrimary: false,
  dirty: 0,
  aheadOfStart: 0,
  startRef: 'HEAD',
  sessions: 2,
};

describe('worktreeRowDetail', () => {
  test('names the branch, the chat count and the tree state', () => {
    expect(worktreeRowDetail(base)).toBe('wt/cosmic-dolphin checked out here · 2 chats · clean');
  });

  test('a single chat is not "1 chats"', () => {
    expect(worktreeRowDetail({ ...base, sessions: 1 })).toContain('1 chat ·');
  });

  test('changed files are counted', () => {
    expect(worktreeRowDetail({ ...base, dirty: 3 })).toContain('3 changed');
  });

  test('a detached row names a commit instead of a branch', () => {
    expect(worktreeRowDetail({ ...base, branch: '', detached: true })).toContain('detached @ a1b2c3d');
  });

  test('a missing worktree says its chats still open — that is why the row stays', () => {
    expect(worktreeRowDetail({ ...base, missing: true })).toContain('its chats still open');
  });
});

describe('removal rules', () => {
  test('a clean worktree with no commits of its own may lose its branch', () => {
    expect(branchDeletable(base)).toBe(true);
    expect(removalRefusal(base)).toBeNull();
  });

  test('a branch with commits of its own is kept, and the checkbox is disabled', () => {
    expect(branchDeletable({ ...base, aheadOfStart: 2 })).toBe(false);
    // The worktree itself is still removable: only the branch is protected.
    expect(removalRefusal({ ...base, aheadOfStart: 2 })).toBeNull();
  });

  test('a dirty worktree is refused with its count', () => {
    expect(removalRefusal({ ...base, dirty: 1 })).toBe('1 uncommitted file here would be lost.');
    expect(removalRefusal({ ...base, dirty: 4 })).toBe('4 uncommitted files here would be lost.');
  });

  test('the main checkout is never removable', () => {
    expect(removalRefusal({ ...base, isPrimary: true })).toContain('main checkout');
  });

  test('a detached row has no branch to delete', () => {
    expect(branchDeletable({ ...base, branch: '', detached: true })).toBe(false);
  });
});