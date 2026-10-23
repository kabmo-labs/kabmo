/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Branch naming and slugging.
 *
 * Two rules here are load-bearing and each was a defect first:
 *
 *  - `slug('..')` is `..`, and `path.join(root, '..')` escapes the root — so a
 *    dot-only result is REJECTED, not passed through.
 *  - our own `wt/` namespace is stripped from the folder (the folder does not
 *    repeat it) while a repository's own namespace stays visible (`feat/x` →
 *    `feat-x`), so a folder never reads as a second branch name.
 */

import { describe, expect, test } from 'bun:test';
import {
  defaultWorktreeBranch,
  folderNameForBranch,
  generateBranchSlug,
  isPlausibleBranchName,
  normalizeBranchName,
  slugWorktreeName,
  WORKTREE_BRANCH_PREFIX,
} from '@/shared/lib/workspace/worktree/branch-name';

describe('worktree branch names', () => {
  test('the generated branch carries our namespace', () => {
    const branch = defaultWorktreeBranch();
    expect(branch.startsWith(`${WORKTREE_BRANCH_PREFIX}/`)).toBe(true);
    expect(branch.slice(WORKTREE_BRANCH_PREFIX.length + 1)).toMatch(/^[a-z]+-[a-z]+$/);
  });

  test('the ref namespace is stripped and only that', () => {
    expect(normalizeBranchName('refs/heads/wt/x')).toBe('wt/x');
    expect(normalizeBranchName('heads/wt/x')).toBe('wt/x');
    expect(normalizeBranchName('  wt/x  ')).toBe('wt/x');
  });
});

describe('folder naming', () => {
  test('our namespace is stripped, a repository namespace is kept', () => {
    expect(folderNameForBranch('wt/cosmic-dolphin')).toBe('cosmic-dolphin');
    expect(folderNameForBranch('feat/payments')).toBe('feat-payments');
    expect(folderNameForBranch('refs/heads/wt/yak')).toBe('yak');
    expect(folderNameForBranch('plain')).toBe('plain');
  });

  test('a folder is one path segment and cannot escape its root', () => {
    expect(slugWorktreeName('../../etc/passwd')).toBe('etc-passwd');
    expect(slugWorktreeName('a b/c')).toBe('a-b-c');
    expect(slugWorktreeName('-weird-')).toBe('weird');
    // The trap: these two ARE valid path segments and would leave the root.
    expect(slugWorktreeName('..')).toBe('');
    expect(slugWorktreeName('.')).toBe('');
    expect(slugWorktreeName('...')).toBe('');
  });

  test('a folder name is bounded', () => {
    expect(slugWorktreeName('x'.repeat(200)).length).toBeLessThanOrEqual(80);
  });

  test('a non-Latin branch leaves no slug, so the caller generates a name', () => {
    expect(folderNameForBranch('测试分支')).toBe('');
  });
});

describe('generated slugs', () => {
  test('stay inside the word lists and vary', () => {
    const seen = new Set<string>();
    for (let index = 0; index < 60; index += 1) seen.add(generateBranchSlug());
    expect(seen.size).toBeGreaterThan(10);
    for (const slug of seen) expect(slug).toMatch(/^[a-z]+-[a-z]+$/);
  });
});

describe('branch name plausibility', () => {
  test('accepts what git accepts', () => {
    expect(isPlausibleBranchName('wt/ok')).toBe(true);
    expect(isPlausibleBranchName('feat/payments-v2')).toBe(true);
  });

  test('refuses what git refuses, before git has to say so', () => {
    expect(isPlausibleBranchName('')).toBe(false);
    expect(isPlausibleBranchName('has space')).toBe(false);
    expect(isPlausibleBranchName('a..b')).toBe(false);
    expect(isPlausibleBranchName('-leading')).toBe(false);
    expect(isPlausibleBranchName('trailing/')).toBe(false);
    expect(isPlausibleBranchName('tilde~1')).toBe(false);
    expect(isPlausibleBranchName('at@{1}')).toBe(false);
    expect(isPlausibleBranchName('a//b')).toBe(false);
  });
});
