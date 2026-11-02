/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Files panel's collapsed folder chains.
 *
 * Two rules, and each is a way the panel would show the wrong thing:
 *
 * 1. **A folder holding exactly one folder is ONE row.** A row per directory
 *    level spends four rows on a package tree (`com`, `java`, `app`,
 *    `package`) and makes the reader scroll past all of them to reach the files
 *    inside. The row's IDENTITY is the deepest directory — what an expand
 *    reads, and what a rename, delete or drag acts on — while only its `name`
 *    carries the chain.
 * 2. **A reveal expands the rows that are DRAWN.** Deriving the ancestors from
 *    the path's own segments puts `lib` and `lib/deep` in the expansion set
 *    when the single row is `lib/deep`, and the next refresh then reads each of
 *    them from disk for nothing.
 */

import { describe, expect, test } from 'bun:test';
import type { FsNode } from '@/shared/types';
import { chainLevelPaths, drawnAncestors, foldSingleChildFolders, unfoldChains } from '@/shared/lib/fs/folder-chain';

const baseNameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
const file = (path: string): FsNode => ({ name: baseNameOf(path), path, type: 'file' });
const folder = (path: string, children?: FsNode[]): FsNode =>
  children ? { name: baseNameOf(path), path, type: 'folder', children } : { name: baseNameOf(path), path, type: 'folder' };

describe('foldSingleChildFolders', () => {
  test('a folder holding exactly one folder becomes one row naming the chain', () => {
    const tree = [folder('com', [folder('com/java', [folder('com/java/app', [file('com/java/app/Main.java')])])])];
    const folded = foldSingleChildFolders(tree);

    expect(folded).toHaveLength(1);
    expect(folded[0]!.name).toBe('com/java/app');
    expect(folded[0]!.path).toBe('com/java/app');
    expect(folded[0]!.children?.map((node) => node.path)).toEqual(['com/java/app/Main.java']);
  });

  test('a folder holding a folder AND a file is not folded', () => {
    const tree = [folder('src', [folder('src/deep', []), file('src/a.ts')])];
    const folded = foldSingleChildFolders(tree);

    expect(folded[0]!.name).toBe('src');
    expect(folded[0]!.children).toHaveLength(2);
  });

  test('a folder whose children are not loaded cannot fold', () => {
    const unread: FsNode = { name: 'src', path: 'src', type: 'folder' };
    expect(foldSingleChildFolders([unread])[0]).toBe(unread);
  });

  test('an unchanged tree keeps its own array and node identities', () => {
    const tree = [folder('src', [file('src/a.ts'), file('src/b.ts')])];
    const folded = foldSingleChildFolders(tree);

    expect(folded).toBe(tree);
    expect(folded[0]).toBe(tree[0]);
  });

  test('the folded row wears the deepest directory’s ignored flag', () => {
    const tree = [folder('a', [{ name: 'b', path: 'a/b', type: 'folder', ignored: true, children: [] }])];
    expect(foldSingleChildFolders(tree)[0]!.ignored).toBe(true);
  });
});

describe('chainLevelPaths', () => {
  test('the levels a folded row stands for, outermost first', () => {
    expect(chainLevelPaths('dev/src/main/code', 'dev/src/main/code')).toEqual([
      'dev',
      'dev/src',
      'dev/src/main',
      'dev/src/main/code',
    ]);
    // A chain inside a folder is labelled relative to that folder, so only the
    // part of the path the label names moves.
    expect(chainLevelPaths('com/java/app/package', 'java/app/package')).toEqual([
      'com/java',
      'com/java/app',
      'com/java/app/package',
    ]);
  });

  test('a row whose label is its own name is not a chain', () => {
    expect(chainLevelPaths('src/deep', 'deep')).toBeNull();
    expect(chainLevelPaths('src', 'src')).toBeNull();
    // A label naming more segments than the path has cannot be a chain.
    expect(chainLevelPaths('a', 'b/c')).toBeNull();
  });
});

describe('unfoldChains', () => {
  const chain = (): FsNode[] => [{
    name: 'dev/src/main/code',
    path: 'dev/src/main/code',
    type: 'folder',
    children: [file('dev/src/main/code/a.ts')],
  }];

  test('a named chain becomes one row per directory, the deepest keeping its children', () => {
    const { nodes, roots } = unfoldChains(chain(), new Set(['dev/src/main/code']));

    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.name).toBe('dev');
    expect(nodes[0]!.path).toBe('dev');
    expect(nodes[0]!.children?.[0]!.path).toBe('dev/src');
    expect(nodes[0]!.children?.[0]!.children?.[0]!.path).toBe('dev/src/main');
    const deepest = nodes[0]!.children![0]!.children![0]!.children![0]!;
    expect(deepest.name).toBe('code');
    expect(deepest.path).toBe('dev/src/main/code');
    // The deepest level is the row that owns the read, so unfolding costs none.
    expect(deepest.children?.map((node) => node.path)).toEqual(['dev/src/main/code/a.ts']);
    expect(roots.get('dev')).toBe('dev/src/main/code');
  });

  test('a chain nothing unfolded keeps its own array and node identities', () => {
    const tree = chain();
    const projected = unfoldChains(tree, new Set());

    expect(projected.nodes).toBe(tree);
    expect(projected.roots.size).toBe(0);
  });

  test('a plain folder is not unfoldable, even when it is named', () => {
    const tree = [folder('src', [file('src/a.ts')])];
    expect(unfoldChains(tree, new Set(['src'])).nodes[0]).toBe(tree[0]);
  });

  test('a chain nested inside an open branch unfolds in place', () => {
    // The shape the server lists for `com`: its one child is folded into a row
    // labelled relative to `com`, whose path is the chain's deepest directory.
    const tree = [folder('com', [{
      name: 'java/app',
      path: 'com/java/app',
      type: 'folder',
      children: [file('com/java/app/Main.java')],
    }])];
    const { nodes, roots } = unfoldChains(tree, new Set(['com/java/app']));

    expect(nodes[0]!.path).toBe('com');
    expect(nodes[0]!.children?.[0]!.path).toBe('com/java');
    expect(nodes[0]!.children?.[0]!.children?.[0]!.path).toBe('com/java/app');
    expect(roots.get('com/java')).toBe('com/java/app');
  });
});

describe('drawnAncestors', () => {
  test('a reveal expands only the rows that exist, never a chain’s inner levels', () => {
    const tree = [folder('lib/deep', [])];

    // `lib` is not a row — `lib/deep` is — so expanding it would put a path in
    // the expansion set that nothing draws and the next refresh re-reads.
    expect(drawnAncestors(tree, 'lib/deep/x.ts')).toEqual(['lib/deep']);
    expect(drawnAncestors(tree, 'lib/x.ts')).toEqual([]);
  });

  test('a nested row’s ancestors are its drawn parents, outermost first', () => {
    const tree = [folder('src', [folder('src/nested', [])])];

    expect(drawnAncestors(tree, 'src/nested/a.ts')).toEqual(['src', 'src/nested']);
    expect(drawnAncestors(tree, 'a.ts')).toEqual([]);
  });
});

