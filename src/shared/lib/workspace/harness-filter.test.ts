/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The harness filter's two rules, in isolation.
 *
 * The failure mode is a list that lies: an entry whose count is about the current
 * filter instead of the workspace, or a workspace drawn as an empty header
 * because its rows were filtered away. Both are asserted here rather than
 * through the mounted sidebar, which cannot tell a wrong count from a right one
 * without the same arithmetic.
 */

import { describe, expect, test } from 'bun:test';
import {
  harnessFilterFolders,
  harnessFilterOptions,
} from '@/shared/lib/workspace/harness-filter';
import type { SessionItemData, WorkspaceFolderData } from '@/shared/types';

function session(id: string, harness?: string): SessionItemData {
  return { id, folder_id: 1, title: id, ...(harness ? { harness } : {}) };
}

function folder(id: number, sessions: SessionItemData[]): WorkspaceFolderData {
  return { id, name: `ws-${id}`, isExpanded: false, hasMore: false, totalSessions: sessions.length, sessions };
}

describe('harnessFilterOptions', () => {
  test('counts every harness over the whole list, most-used first', () => {
    const folders = [
      folder(1, [session('a', 'omp-rpc'), session('b', 'claude'), session('c', 'omp-rpc')]),
      folder(2, [session('d', 'codex')]),
    ];

    expect(harnessFilterOptions(folders)).toEqual([
      { harness: 'omp-rpc', label: 'omp', count: 2 },
      { harness: 'claude', label: 'claude', count: 1 },
      { harness: 'codex', label: 'codex', count: 1 },
    ]);
  });

  test('a row with no harness belongs to no entry', () => {
    const folders = [folder(1, [session('a'), session('b', 'claude')])];

    expect(harnessFilterOptions(folders).map((option) => option.harness)).toEqual(['claude']);
  });

  test('an empty list has no entries', () => {
    expect(harnessFilterOptions([])).toEqual([]);
  });
});

describe('harnessFilterFolders', () => {
  test('null returns the input untouched', () => {
    const folders = [folder(1, [session('a', 'claude')])];

    expect(harnessFilterFolders(folders, null)).toBe(folders);
  });

  test('keeps only the chosen harness and drops a workspace with nothing left', () => {
    const folders = [
      folder(1, [session('a', 'omp-rpc'), session('b', 'claude')]),
      folder(2, [session('c', 'codex')]),
    ];

    const filtered = harnessFilterFolders(folders, 'claude');

    expect(filtered.map((entry) => entry.id)).toEqual([1]);
    expect(filtered[0]?.sessions.map((entry) => entry.id)).toEqual(['b']);
  });

  test('a row with no harness is not claimed by any filter', () => {
    const folders = [folder(1, [session('a'), session('b', 'claude')])];

    expect(harnessFilterFolders(folders, 'claude')[0]?.sessions.map((entry) => entry.id)).toEqual(['b']);
    expect(harnessFilterFolders(folders, 'omp-rpc')).toEqual([]);
  });

  test('does not mutate the input folders', () => {
    const folders = [folder(1, [session('a', 'omp-rpc'), session('b', 'claude')])];

    harnessFilterFolders(folders, 'claude');

    expect(folders[0]?.sessions).toHaveLength(2);
  });
});
