/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';

import { formatCommitCount } from '@/shared/lib/fs/commit-count';

describe('formatCommitCount', () => {
  // The reported bug: a 646-commit branch whose first page is 50 rows read
  // "50 commits", which is the page size, not the history.
  test('reports the loaded page against the branch total', () => {
    expect(formatCommitCount({ matches: 50, loaded: 50, total: 646, hasMore: true })).toBe('50 of 646');
  });

  test('reports the bare total once the whole history is loaded', () => {
    expect(formatCommitCount({ matches: 646, loaded: 646, total: 646, hasMore: false })).toBe('646 commits');
  });

  // A branch holding fewer commits than one page: `loaded === total` with
  // `hasMore` still true would be a contradiction, so hasMore wins and the
  // pair is shown rather than a total that would hide the pending page.
  test('shows the pair while a page is still pending', () => {
    expect(formatCommitCount({ matches: 50, loaded: 50, total: 50, hasMore: true })).toBe('50 of 50');
  });

  // The filter only sees the loaded page, so the denominator must be that page.
  test('a search reports matches against the loaded page, never the total', () => {
    expect(formatCommitCount({ matches: 18, loaded: 50, total: 646, hasMore: true, isFiltering: true })).toBe(
      '18 of 50 loaded'
    );
  });

  test('an empty search result still names the page it searched', () => {
    expect(formatCommitCount({ matches: 0, loaded: 50, total: 646, hasMore: true, isFiltering: true })).toBe(
      '0 of 50 loaded'
    );
  });

  // No total from git (a branch with no commits, or a response that omitted it).
  test('marks an unknown total as partial while more may follow', () => {
    expect(formatCommitCount({ matches: 50, loaded: 50, hasMore: true })).toBe('50+ commits');
    expect(formatCommitCount({ matches: 12, loaded: 12, hasMore: false })).toBe('12 commits');
  });

  test('a zero total is treated as unknown rather than as a count', () => {
    expect(formatCommitCount({ matches: 20, loaded: 20, total: 0, hasMore: false })).toBe('20 commits');
  });
});
