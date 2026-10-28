/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';

import {
  compareFolders,
  DEFAULT_SESSION_SORT_OPTION,
  isValidSessionSortOption,
  sortFolders,
} from '@/shared/lib/workspace/sidebar-sort';
import type { SessionItemData, SessionSortOption, WorkspaceFolderData } from '@/shared/types';

/** Minimal session factory — only the fields the comparator reads. */
function makeSession(
  id: number | string,
  createdAt?: string,
  updatedAt?: string,
): SessionItemData {
  return {
    id,
    folder_id: 0,
    title: `session-${id}`,
    ...(createdAt !== undefined ? { created_at: createdAt } : {}),
    ...(updatedAt !== undefined ? { updated_at: updatedAt } : {}),
  };
}

/** Minimal folder factory — fills the fields the comparator ignores. */
function makeFolder(
  id: number,
  name: string,
  sessions: SessionItemData[] = [],
  isPinned = false,
): WorkspaceFolderData {
  return {
    id,
    name,
    isPinned,
    isExpanded: false,
    sessions,
    hasMore: false,
    totalSessions: sessions.length,
  };
}

const ALL_OPTIONS: readonly SessionSortOption[] = [
  'A-Z',
  'Z-A',
  'LATEST_SESSION',
  'LATEST_ADDED',
];

describe('sidebar-sort', () => {
  test('A-Z sorts folder names ascending', () => {
    const folders = [makeFolder(1, 'zeta'), makeFolder(2, 'alpha'), makeFolder(3, 'mid')];
    const sorted = sortFolders(folders, 'A-Z');
    expect(sorted.map((f) => f.name)).toEqual(['alpha', 'mid', 'zeta']);
  });

  test('Z-A sorts folder names descending', () => {
    const folders = [makeFolder(1, 'alpha'), makeFolder(2, 'zeta'), makeFolder(3, 'mid')];
    const sorted = sortFolders(folders, 'Z-A');
    expect(sorted.map((f) => f.name)).toEqual(['zeta', 'mid', 'alpha']);
  });

  test('A-Z puts pinned folders first even when their name sorts last', () => {
    const folders = [
      makeFolder(1, 'alpha'),
      makeFolder(2, 'zeta', [], true),
      makeFolder(3, 'mid'),
    ];
    const sorted = sortFolders(folders, 'A-Z');
    expect(sorted.map((f) => f.name)).toEqual(['zeta', 'alpha', 'mid']);
  });

  test('LATEST_SESSION orders by newest updated_at desc with omp UUID string ids', () => {
    const alpha = makeFolder(1, 'alpha', [
      makeSession('ses_alpha', undefined, '2024-01-01T00:00:00.000Z'),
    ]);
    const beta = makeFolder(2, 'beta', [
      makeSession('ses_beta', undefined, '2024-06-01T00:00:00.000Z'),
    ]);
    // Regression: comparing UUID strings numerically produced NaN -> no-op sort.
    expect(Number.isNaN(compareFolders(alpha, beta, 'LATEST_SESSION'))).toBe(false);
    const sorted = sortFolders([alpha, beta], 'LATEST_SESSION');
    expect(sorted.map((f) => f.name)).toEqual(['beta', 'alpha']);
  });

  test('LATEST_SESSION falls back to created_at when updated_at is absent', () => {
    const older = makeFolder(1, 'older', [
      makeSession('ses_old', '2024-02-01T00:00:00.000Z'),
    ]);
    const newer = makeFolder(2, 'newer', [
      makeSession('ses_new', '2024-09-01T00:00:00.000Z'),
    ]);
    const sorted = sortFolders([older, newer], 'LATEST_SESSION');
    expect(sorted.map((f) => f.name)).toEqual(['newer', 'older']);
  });

  test('LATEST_SESSION breaks identical timestamps by highest numeric session id desc', () => {
    const shared = '2024-03-03T00:00:00.000Z';
    const low = makeFolder(1, 'low', [
      makeSession(5, shared, shared),
      makeSession(9, shared, shared),
    ]);
    const high = makeFolder(2, 'high', [makeSession(42, shared, shared)]);
    const sorted = sortFolders([low, high], 'LATEST_SESSION');
    expect(sorted.map((f) => f.name)).toEqual(['high', 'low']);
  });

  test('LATEST_SESSION puts a folder with no sessions after folders with activity', () => {
    const empty = makeFolder(1, 'empty', []);
    const active = makeFolder(2, 'active', [
      makeSession('ses_x', undefined, '2024-05-05T00:00:00.000Z'),
    ]);
    const sorted = sortFolders([empty, active], 'LATEST_SESSION');
    expect(sorted.map((f) => f.name)).toEqual(['active', 'empty']);
  });

  test('LATEST_SESSION puts a folder carrying a fresh pending session first', () => {
    const pending = makeFolder(1, 'pending', [
      makeSession('new-1737000000000', undefined, '2025-01-16T04:00:00.000Z'),
    ]);
    const settled = makeFolder(2, 'settled', [
      makeSession('ses_settled', undefined, '2024-01-01T00:00:00.000Z'),
    ]);
    const sorted = sortFolders([settled, pending], 'LATEST_SESSION');
    expect(sorted.map((f) => f.name)).toEqual(['pending', 'settled']);
  });

  test('LATEST_ADDED puts the highest numeric folder id first', () => {
    const folders = [makeFolder(7, 'seven'), makeFolder(3, 'three'), makeFolder(20, 'twenty')];
    const sorted = sortFolders(folders, 'LATEST_ADDED');
    expect(sorted.map((f) => f.name)).toEqual(['twenty', 'seven', 'three']);
  });

  test('compareFolders returns a finite number for every option with UUID ids and no timestamps', () => {
    const a = makeFolder(1, 'a', [makeSession('ses_alpha')]);
    const b = makeFolder(2, 'b', [makeSession('ses_beta')]);
    for (const option of ALL_OPTIONS) {
      expect(Number.isNaN(compareFolders(a, b, option))).toBe(false);
      expect(Number.isNaN(compareFolders(b, a, option))).toBe(false);
    }
  });

  test('sortFolders does not mutate its input array', () => {
    const folders = [makeFolder(1, 'zeta'), makeFolder(2, 'alpha'), makeFolder(3, 'mid')];
    const before = folders.map((f) => f.name);
    sortFolders(folders, 'A-Z');
    expect(folders.map((f) => f.name)).toEqual(before);
  });

  test('sessions inside a folder are left untouched after sorting', () => {
    const sessions = [
      makeSession('ses_one', undefined, '2024-01-01T00:00:00.000Z'),
      makeSession('ses_two', undefined, '2024-02-01T00:00:00.000Z'),
    ];
    const folder = makeFolder(1, 'keep', sessions);
    const other = makeFolder(2, 'other', []);
    const sorted = sortFolders([other, folder], 'LATEST_SESSION');
    const kept = sorted.find((f) => f.name === 'keep');
    expect(kept?.sessions).toBe(sessions);
    expect(kept?.sessions.map((s) => s.id)).toEqual(['ses_one', 'ses_two']);
  });
});

describe('isValidSessionSortOption', () => {
  test('the default option is a valid, menu-listed value', () => {
    expect(DEFAULT_SESSION_SORT_OPTION).toBe('LATEST_SESSION');
    expect(ALL_OPTIONS).toContain(DEFAULT_SESSION_SORT_OPTION);
  });

  test('returns true for all four supported options', () => {
    for (const option of ALL_OPTIONS) {
      expect(isValidSessionSortOption(option)).toBe(true);
    }
  });

  test('returns false for non-options and mistyped values', () => {
    const invalid: unknown[] = [
      undefined,
      null,
      '',
      'latest_session',
      'LATEST',
      42,
      {},
      [],
      true,
      'A-Z ',
    ];
    for (const value of invalid) {
      expect(isValidSessionSortOption(value)).toBe(false);
    }
  });

  test('narrows the value so sortFolders accepts it without a cast', () => {
    const folders = [makeFolder(1, 'zeta'), makeFolder(2, 'alpha')];
    const candidate: unknown = 'A-Z';
    if (isValidSessionSortOption(candidate)) {
      const sorted = sortFolders(folders, candidate);
      expect(sorted.map((f) => f.name)).toEqual(['alpha', 'zeta']);
    } else {
      throw new Error('expected the guard to narrow "A-Z"');
    }
  });
});
