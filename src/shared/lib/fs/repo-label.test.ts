/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The label and grouping rules behind the repo picker.
 *
 * Both are shared by five panels, so a mistake here is one mistake rendered in
 * five places. The grouping has the load-bearing half: the list must sort, or a
 * workspace whose `readdir` order differs between two reads renders its rows in
 * a different order each time the dialog opens — and a list nobody can scan is
 * the thing the modal exists to fix.
 */

import { describe, expect, test } from 'bun:test';
import { groupRepos, repoNameWithinGroup } from '@/shared/lib/fs/repo-groups';
import { repoLabel, repoShortLabel, workspaceFolderName } from '@/shared/lib/fs/repo-label';

describe('workspaceFolderName', () => {
  test('names the root by its last path segment', () => {
    expect(workspaceFolderName('/home/dev/JatisMobile/Workspace')).toBe('Workspace');
  });

  test('a trailing separator names the same directory', () => {
    expect(workspaceFolderName('/home/dev/Workspace/')).toBe('Workspace');
  });

  test('a Windows path splits on backslashes too', () => {
    expect(workspaceFolderName('C:\\work\\chamber')).toBe('chamber');
  });

  test('a path with no name falls back rather than labelling empty', () => {
    expect(workspaceFolderName('/')).toBe('workspace root');
    expect(workspaceFolderName('')).toBe('workspace root');
    expect(workspaceFolderName(undefined)).toBe('workspace root');
  });
});

describe('repoLabel', () => {
  test('the root reads as the workspace folder', () => {
    expect(repoLabel('.', '/home/dev/Workspace')).toBe('Workspace');
  });

  test('a nested repo keeps its whole path', () => {
    // The list is where `jns6_5/token` and `jns7/token` have to be told apart,
    // so the full path is the label rather than the basename.
    expect(repoLabel('projects/jns6_5/token', '/ws')).toBe('projects/jns6_5/token');
  });
});

describe('repoShortLabel', () => {
  test('a nested repo is named by its last segment in a trigger', () => {
    expect(repoShortLabel('projects/jns6_5/token', '/ws')).toBe('token');
  });

  test('the root keeps the workspace folder name', () => {
    expect(repoShortLabel('.', '/home/dev/Workspace')).toBe('Workspace');
  });

  test('a single-segment repo is its own label', () => {
    expect(repoShortLabel('token', '/ws')).toBe('token');
  });
});

describe('groupRepos', () => {
  test('groups by first path segment, root first then folders alphabetically', () => {
    const groups = groupRepos(['projects/b/two', 'projects/a/one', '.', 'other/x']);
    expect(groups.map((g) => g.key)).toEqual(['', 'other', 'projects']);
    expect(groups[0].paths).toEqual(['.']);
    expect(groups[2].paths).toEqual(['projects/a/one', 'projects/b/two']);
  });

  test('a single-segment repo belongs to the root group', () => {
    // `token` IS a direct child of the workspace, which is what the root group
    // means — filing it under a folder named after itself would invent a level.
    const groups = groupRepos(['token', '.']);
    expect(groups).toHaveLength(1);
    expect(groups[0].paths).toEqual(['.', 'token']);
  });

  test('sorts within a group so two reads render the same order', () => {
    // `findGitDirs` pushes in readdir order, which is filesystem order.
    const shuffled = groupRepos(['p/z', 'p/a', 'p/m']);
    const reversed = groupRepos(['p/m', 'p/a', 'p/z']);
    expect(shuffled[0].paths).toEqual(['p/a', 'p/m', 'p/z']);
    expect(reversed[0].paths).toEqual(shuffled[0].paths);
  });

  test('the root group leads even when its key sorts last alphabetically', () => {
    const groups = groupRepos(['.', 'zzz/x']);
    expect(groups.map((g) => g.key)).toEqual(['', 'zzz']);
  });

  test('an empty list answers no groups', () => {
    expect(groupRepos([])).toEqual([]);
  });

  test('a root group has no heading; a folder group is headed by its name', () => {
    const groups = groupRepos(['.', 'projects/x']);
    expect(groups[0].label).toBeNull();
    expect(groups[1].label).toBe('projects');
  });
});

describe('repoNameWithinGroup', () => {
  test('the part below the heading, so the folder is not repeated', () => {
    expect(repoNameWithinGroup('projects/jns6_5/token', 'projects')).toBe('jns6_5/token');
  });

  test('a repo in the root group keeps its whole path', () => {
    expect(repoNameWithinGroup('token', '')).toBe('token');
  });

  test('the root itself is named, not left as a dot', () => {
    expect(repoNameWithinGroup('.', '')).toBe('workspace root');
  });
});
