/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `buildGitTree` folds a flat `git status` list into the nested tree the Source
 * Control view renders.
 *
 * The cases pin the shapes that a naive fold gets wrong: a file three
 * directories deep must create each level ONCE (a second change in the same
 * folder must not duplicate it), folders sort before files with each group
 * alphabetical, an explicit `dir/` entry is a folder carrying its own change
 * rather than a phantom file, and a leading `./` or `/` never becomes a path
 * segment. `changeCount` is the roll-up the folder rows display, so a parent
 * must count its whole subtree.
 *
 * Pure function, so this file needs no DOM.
 */

import { describe, expect, test } from 'bun:test';
import { buildGitTree } from '@/client/hooks/workspace/git-tree';
import type { GitChange } from '@/shared/types/git';

const change = (file: string, staged = false): GitChange => ({ file, status: 'M', staged });

describe('buildGitTree', () => {
  test('nests a deep path once per level and keeps siblings sorted, folders first', () => {
    const tree = buildGitTree([change('src/lib/fs/store.ts'), change('src/app.ts'), change('README.md'), change('src/lib/fs/git.ts')]);

    // Files sort after folders, alphabetically within each group.
    expect(tree.map((n) => `${n.type}:${n.name}`)).toEqual(['folder:src', 'file:README.md']);

    const src = tree[0];
    expect(src.id).toBe('src');
    expect(src.changeCount).toBe(3);
    expect(src.children.map((n) => `${n.type}:${n.name}`)).toEqual(['folder:lib', 'file:app.ts']);

    const lib = src.children[0];
    expect(lib.path).toBe('src/lib');
    expect(lib.changeCount).toBe(2);
    expect(lib.children.map((n) => n.name)).toEqual(['fs']);

    const fs = lib.children[0];
    expect(fs.children.map((n) => n.name)).toEqual(['git.ts', 'store.ts']);
    expect(fs.children[0].change?.file).toBe('src/lib/fs/git.ts');
    expect(fs.children[0].changeCount).toBe(1);
  });

  test('an explicit directory entry becomes a folder carrying its change, not a phantom file', () => {
    const tree = buildGitTree([change('vendor/')]);
    expect(tree).toHaveLength(1);
    expect(tree[0].type).toBe('folder');
    expect(tree[0].name).toBe('vendor');
    expect(tree[0].change?.file).toBe('vendor/');
    expect(tree[0].children).toEqual([]);
    expect(tree[0].changeCount).toBe(1);
  });

  test('a second change in the same folder reuses that folder instead of duplicating it', () => {
    const tree = buildGitTree([change('src/a.ts'), change('src/b.ts'), change('src/nested/c.ts')]);
    expect(tree).toHaveLength(1);
    expect(tree[0].children.map((n) => n.name)).toEqual(['nested', 'a.ts', 'b.ts']);
    expect(tree[0].changeCount).toBe(3);
  });

  test('strips a leading ./ and / before splitting, and returns [] for no changes', () => {
    const tree = buildGitTree([change('./src/app.ts'), change('/README.md')]);
    expect(tree.map((n) => n.name)).toEqual(['src', 'README.md']);
    expect(tree[0].children[0].name).toBe('app.ts');
    expect(buildGitTree([])).toEqual([]);
  });
});
