/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The worktree chip on a session row.
 *
 * What it must say, and the one state that changes the words rather than only
 * the colour: a worktree whose folder was deleted outside Kabmo keeps its row
 * (that is how the transcript stays reachable) and must not read as an ordinary
 * checkout.
 */

import { describe, expect, test } from 'bun:test';
import {
  WORKTREE_BADGE_MISSING_SUFFIX,
  worktreeBadgeLabel,
  worktreeBadgeTitle,
} from '@/client/components/layout/session-sidebar/WorktreeBadge';
import type { SessionWorktreeInfo } from '@/shared/lib/workspace/worktree/types';

const ready: SessionWorktreeInfo = {
  branch: 'wt/cosmic-dolphin',
  path: '/data/worktrees/abc/cosmic-dolphin',
  primaryRoot: '/repo',
  status: 'ready',
  detached: false,
};

describe('worktree badge', () => {
  test('names the branch', () => {
    expect(worktreeBadgeLabel(ready)).toBe('wt/cosmic-dolphin');
    expect(worktreeBadgeTitle(ready)).toContain('/data/worktrees/abc/cosmic-dolphin');
  });

  test('a missing worktree says so in the label, not only in the colour', () => {
    const missing: SessionWorktreeInfo = { ...ready, status: 'missing' };
    expect(worktreeBadgeLabel(missing)).toContain(WORKTREE_BADGE_MISSING_SUFFIX);
    expect(worktreeBadgeTitle(missing)).toMatch(/missing/i);
  });

  test('a detached HEAD has a name instead of an empty chip', () => {
    const detached: SessionWorktreeInfo = { ...ready, branch: '', detached: true };
    expect(worktreeBadgeLabel(detached)).toBe('detached');
    expect(worktreeBadgeTitle(detached)).toMatch(/detached/i);
  });
});