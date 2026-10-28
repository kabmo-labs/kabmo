/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Tests for the git-status presentation layer.
 *
 * The status badge is the only place a user learns whether a file is staged,
 * untracked, or deleted, and the two porcelain columns disagree about that:
 * the first column is the index, the second the worktree. Every case below
 * pins which column the label comes from, because reading the wrong column
 * paints a staged add as a plain modification. The folder roll-up cases pin the
 * count and the color precedence, since a folder's dot is what a collapsed tree
 * shows and a wrong precedence hides a conflicted or deleted subtree.
 */

import { describe, expect, test } from 'bun:test';

import type { GitChange } from '@/shared/types/git';
import { buildGitStatusMaps, getGitStatusInfo } from '@/shared/lib/fs/git-status';

function change(file: string, status: string, staged = false): GitChange {
  return { file, status, staged };
}

describe('getGitStatusInfo: unstaged status codes', () => {
  test('an empty or missing code falls back to a plain modification', () => {
    expect(getGitStatusInfo('')).toEqual({
      charStatus: 'M',
      label: 'Modified',
      colorClass: 'text-info',
      badgeBgClass: 'bg-info/10 text-info border-info/25',
      isStaged: false,
    });
  });

  test('a leading space (worktree-only change) still reads as modified', () => {
    expect(getGitStatusInfo(' M').label).toBe('Modified');
  });

  test('a trailing space (index-only change) reads as modified', () => {
    expect(getGitStatusInfo('M ').label).toBe('Modified');
  });

  test('a two-character code is read from its worktree column', () => {
    // 'AM' is added to the index and modified again in the worktree; the
    // worktree column wins so the row is not labelled "Added".
    expect(getGitStatusInfo('AM')).toMatchObject({ charStatus: 'M', label: 'Modified' });
  });

  test('added, deleted and renamed map to their labels and tones', () => {
    expect(getGitStatusInfo('A')).toMatchObject({
      charStatus: 'A',
      label: 'Added',
      colorClass: 'text-success',
    });
    expect(getGitStatusInfo('D')).toMatchObject({
      charStatus: 'D',
      label: 'Deleted',
      colorClass: 'text-error',
    });
    expect(getGitStatusInfo('R')).toMatchObject({
      charStatus: 'R',
      label: 'Renamed',
      colorClass: 'text-meta',
    });
  });

  test('an unrecognized code (a copy) degrades to modified rather than throwing', () => {
    expect(getGitStatusInfo('C')).toMatchObject({ charStatus: 'M', label: 'Modified' });
  });

  test('untracked is recognized in every spelling the parser emits', () => {
    for (const code of ['??', '?', 'U', 'UNTRACKED']) {
      expect(getGitStatusInfo(code)).toMatchObject({
        charStatus: 'U',
        label: 'Untracked',
        colorClass: 'text-success',
      });
    }
  });

  test('the code is trimmed and case-folded before matching', () => {
    expect(getGitStatusInfo(' untracked ').label).toBe('Untracked');
    expect(getGitStatusInfo(' a ').label).toBe('Added');
  });

  test('unmerged porcelain pairs get their own branch, not a fall-through', () => {
    // Each pair's two letters are the two SIDES of a conflict, not an
    // index/worktree pair. Before this table existed every one of them was read
    // through the columns below, so `UU`/`UA`/`UD` fell through to the
    // untracked branch (`U` is the worktree letter of both) and `AA`/`DD`/`AU`
    // reported as staged — a conflicted file described as either a file git has
    // never heard of or a change already staged.
    const expected: Record<string, string> = {
      UU: 'Conflicted — both modified',
      AA: 'Conflicted — both added',
      DD: 'Conflicted — both deleted',
      AU: 'Conflicted — added by us',
      UA: 'Conflicted — added by them',
      DU: 'Conflicted — deleted by us',
      UD: 'Conflicted — deleted by them',
    };
    for (const [code, label] of Object.entries(expected)) {
      // Both call shapes: the list passes `false`, and a stale caller passing
      // `true` (the flag the columns used to imply) must not change the answer.
      expect(getGitStatusInfo(code).label).toBe(label);
      expect(getGitStatusInfo(code, true).label).toBe(label);
      expect(getGitStatusInfo(code).isConflicted).toBe(true);
      expect(getGitStatusInfo(code).isStaged).toBe(false);
    }
  });
});

describe('getGitStatusInfo: staged status codes', () => {
  test('staged adds, deletes and renames keep their staged labels', () => {
    expect(getGitStatusInfo('A', true)).toEqual({
      charStatus: 'A',
      label: 'Added (Staged)',
      colorClass: 'text-success',
      badgeBgClass: 'bg-success/10 text-success border-success/25',
      isStaged: true,
    });
    expect(getGitStatusInfo('D', true)).toMatchObject({
      charStatus: 'D',
      label: 'Deleted (Staged)',
      colorClass: 'text-error',
    });
    expect(getGitStatusInfo('R', true)).toMatchObject({
      charStatus: 'R',
      label: 'Renamed (Staged)',
      colorClass: 'text-meta',
    });
  });

  test('a staged row is read from its index column, not the worktree column', () => {
    // 'AM' is added in the index and modified again in the worktree. Staged
    // reads column 0; unstaged reads column 1 — so the same pair flips meaning.
    expect(getGitStatusInfo('AM', true)).toMatchObject({ charStatus: 'A', label: 'Added (Staged)' });
    expect(getGitStatusInfo('MA', true)).toMatchObject({ charStatus: 'M', label: 'Modified (Staged)' });
    expect(getGitStatusInfo('MA', false)).toMatchObject({ charStatus: 'A', label: 'Added' });
  });

  test('a staged row with no code defaults to modified (staged)', () => {
    expect(getGitStatusInfo('', true)).toEqual({
      charStatus: 'M',
      label: 'Modified (Staged)',
      colorClass: 'text-info',
      badgeBgClass: 'bg-info/10 text-info border-info/25',
      isStaged: true,
    });
  });

  test('a staged row is still reported as staged', () => {
    expect(getGitStatusInfo('A', true).isStaged).toBe(true);
    expect(getGitStatusInfo('A', false).isStaged).toBe(false);
  });
});

describe('buildGitStatusMaps', () => {
  test('a non-array payload yields empty maps instead of throwing', () => {
    const { fileMap, folderMap } = buildGitStatusMaps(null as unknown as GitChange[]);
    expect(fileMap.size).toBe(0);
    expect(folderMap.size).toBe(0);
  });

  test('rows without a file are dropped', () => {
    const rows = [change('', 'M'), null as unknown as GitChange, change('a.ts', 'M')];
    const { fileMap } = buildGitStatusMaps(rows);
    expect([...fileMap.keys()]).toEqual(['a.ts']);
  });

  test('a leading slash is stripped from the file key', () => {
    const { fileMap } = buildGitStatusMaps([change('/src/a.ts', 'M')]);
    expect(fileMap.has('src/a.ts')).toBe(true);
    expect(fileMap.has('/src/a.ts')).toBe(false);
  });

  test('every ancestor folder is registered, not just the immediate parent', () => {
    const { folderMap } = buildGitStatusMaps([change('a/b/c.ts', 'M')]);
    expect([...folderMap.keys()].sort()).toEqual(['a', 'a/b']);
    expect(folderMap.get('a')?.count).toBe(1);
    expect(folderMap.get('a/b')?.count).toBe(1);
  });

  test('a root-level file registers no folder', () => {
    const { folderMap } = buildGitStatusMaps([change('readme.md', 'M')]);
    expect(folderMap.size).toBe(0);
  });

  test('siblings accumulate the folder count', () => {
    const { folderMap } = buildGitStatusMaps([change('src/a.ts', 'M'), change('src/b.ts', 'M')]);
    expect(folderMap.get('src')?.count).toBe(2);
  });

  test('an untracked-only folder is green', () => {
    const info = buildGitStatusMaps([change('src/a.ts', '??')]).folderMap.get('src');
    expect(info).toMatchObject({ hasUntracked: true, hasModified: false, colorClass: 'text-success' });
  });

  test('a deleted-only folder is red', () => {
    const info = buildGitStatusMaps([change('src/a.ts', ' D')]).folderMap.get('src');
    expect(info).toMatchObject({ hasDeleted: true, colorClass: 'text-error' });
  });

  test('a staged deletion is blue: staged outranks deleted in the color priority', () => {
    const info = buildGitStatusMaps([change('src/a.ts', 'D ', true)]).folderMap.get('src');
    expect(info).toMatchObject({ hasStaged: true, hasDeleted: true, colorClass: 'text-info' });
  });

  test('a modified file outranks an untracked sibling for the folder color', () => {
    const info = buildGitStatusMaps([
      change('src/a.ts', '??'),
      change('src/b.ts', ' M'),
    ]).folderMap.get('src');
    expect(info).toMatchObject({ hasModified: true, hasUntracked: true, colorClass: 'text-info' });
  });

  test('an untracked file outranks a deleted sibling for the folder color', () => {
    const info = buildGitStatusMaps([
      change('src/a.ts', ' D'),
      change('src/b.ts', '??'),
    ]).folderMap.get('src');
    expect(info).toMatchObject({ hasUntracked: true, hasDeleted: true, colorClass: 'text-success' });
  });

  test('a non-space, non-question first column counts as staged', () => {
    const info = buildGitStatusMaps([change('src/a.ts', 'M ')]) .folderMap.get('src');
    expect(info?.hasStaged).toBe(true);

    const untracked = buildGitStatusMaps([change('src/b.ts', '??')]).folderMap.get('src');
    expect(untracked?.hasStaged).toBe(false);
  });

  test('a nested change is counted once per ancestor, deepest included', () => {
    const { folderMap } = buildGitStatusMaps([
      change('a/b/x.ts', 'M'),
      change('a/b/y.ts', 'M'),
      change('a/z.ts', 'M'),
    ]);
    expect(folderMap.get('a')?.count).toBe(3);
    expect(folderMap.get('a/b')?.count).toBe(2);
  });
});
