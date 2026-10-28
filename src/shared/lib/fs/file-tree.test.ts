/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The tree edits that let a create and a rename skip a reload.
 *
 * Each rule here is a way the rendered tree would disagree with the disk:
 *
 * 1. **A nested entry brings the chain that leads to it.** `lib/parse.ts` names
 *    a folder the tree does not carry yet; without the chain the row is placed
 *    under a key no branch reaches and simply never renders.
 * 2. **A collapsed folder is not guessed at.** Its children are not this
 *    tree's knowledge, so an entry created inside one is deliberately NOT
 *    inserted — expanding it reads the real directory, which by then holds the
 *    new entry. Inserting into a guess would show a listing the server never
 *    produced.
 * 3. **A rename re-points every descendant.** A folder's children carry its
 *    path as a prefix; moving the folder without rewriting them leaves rows
 *    whose `path` no longer resolves and an expansion set keyed by names that
 *    are gone.
 * 4. **A rename never loses the moved entry's own loaded children.** Its cache
 *    entry is rekeyed with it, so a folder renamed while open stays open with
 *    its contents.
 */

import { describe, expect, test } from 'bun:test';
import type { FsNode } from '@/shared/types';
import {
  baseNameOf,
  parentPathOf,
  placeEntry,
  rehydrateTree,
  rekeyCache,
  rekeyExpansion,
  renameEntryAt,
  sortEntries,
  takeEntry,
} from '@/shared/lib/fs/file-tree';

const file = (path: string): FsNode => ({ name: baseNameOf(path), path, type: 'file' });
const folder = (path: string, children?: FsNode[]): FsNode =>
  children ? { name: baseNameOf(path), path, type: 'folder', children } : { name: baseNameOf(path), path, type: 'folder' };

describe('placeEntry', () => {
  test('a top-level entry lands in the root, folders first', () => {
    const placed = placeEntry([folder('src'), file('z.ts')], {}, file('a.ts'));

    expect(placed.nodes.map((node) => node.path)).toEqual(['src', 'a.ts', 'z.ts']);
    expect(placed.cache).toEqual({});
  });

  test('a nested entry creates the chain that leads to it', () => {
    const placed = placeEntry([], {}, file('lib/deep/parse.ts'));

    expect(placed.nodes.map((node) => node.path)).toEqual(['lib']);
    expect(placed.cache.lib?.map((node) => node.path)).toEqual(['lib/deep']);
    expect(placed.cache['lib/deep']?.map((node) => node.path)).toEqual(['lib/deep/parse.ts']);
  });

  test('an existing chain is extended, not duplicated', () => {
    const placed = placeEntry([folder('lib')], { lib: [folder('lib/deep')], 'lib/deep': [] }, file('lib/deep/x.ts'));

    expect(placed.nodes).toHaveLength(1);
    expect(placed.cache['lib/deep']?.map((node) => node.path)).toEqual(['lib/deep/x.ts']);
  });

  test('an entry inside a COLLAPSED folder is not inserted', () => {
    // `src` is listed with `children: null` — the tree has never read it, so
    // there is nothing to place the entry into and no guess to make.
    const tree = [folder('src')];
    const placed = placeEntry(tree, {}, file('src/hidden.ts'));

    expect(placed.nodes).toBe(tree);
    expect(placed.cache).toEqual({});
  });

  test('an empty folder is LOADED, and can receive an entry', () => {
    const placed = placeEntry([folder('src')], { src: [] }, file('src/new.ts'));

    expect(placed.cache.src?.map((node) => node.path)).toEqual(['src/new.ts']);
  });

  test('a created folder is a folder in the cache too, so it can be expanded', () => {
    const placed = placeEntry([], {}, folder('packages'));

    expect(placed.nodes[0].type).toBe('folder');
    expect(placed.nodes[0].children).toBeUndefined();
  });

  test('an entry under a collapsed chain row descends into it', () => {
    // The tree draws `lib/deep` as ONE row, whose children are `lib/deep`'s.
    const tree = [folder('lib/deep', [])];
    const placed = placeEntry(tree, { 'lib/deep': [] }, file('lib/deep/x.ts'));

    expect(placed.nodes).toHaveLength(1);
    expect(placed.cache['lib/deep']?.map((node) => node.path)).toEqual(['lib/deep/x.ts']);
  });

  test('an entry beside a chain row unfolds it rather than drawing the folder twice', () => {
    // `lib` holds only `deep`, so the tree draws one row named `lib/deep`. An
    // entry at `lib/other/x.ts` means `lib` now has two children — the row is
    // unfolded into `lib` holding `deep`, and the new chain is inserted under it.
    const tree = [folder('lib/deep', [file('lib/deep/a.ts')])];
    const placed = placeEntry(tree, { 'lib/deep': [file('lib/deep/a.ts')] }, file('lib/other/x.ts'));

    expect(placed.nodes.map((node) => node.path)).toEqual(['lib']);
    expect(placed.cache.lib?.map((node) => node.path)).toEqual(['lib/deep', 'lib/other']);
    expect(placed.cache['lib/other']?.map((node) => node.path)).toEqual(['lib/other/x.ts']);
    // The chain's own children keep their cache entry, keyed by the path they
    // already had, so an open `lib/deep` stays open.
    expect(placed.cache['lib/deep']?.map((node) => node.path)).toEqual(['lib/deep/a.ts']);
  });

  test('an entry in a sibling branch unfolds the chain once and lands under it', () => {
    // The tree draws `com/java/app/package` as ONE row. An entry at
    // `com/java/other/deep/x.ts` shares `com/java`, so the row is unfolded and
    // BOTH branches sit inside it — never `com` twice.
    const tree = [folder('com/java/app/package', [file('com/java/app/package/Main.java')])];
    const placed = placeEntry(tree, {}, file('com/java/other/deep/x.ts'));
    const drawn = rehydrateTree(placed.nodes, placed.cache);

    expect(drawn.map((node) => node.name)).toEqual(['com/java']);
    expect(drawn[0]!.children?.map((node) => node.name)).toEqual(['app/package', 'other/deep']);
    expect(drawn[0]!.children?.[0]!.children?.map((node) => node.path))
      .toEqual(['com/java/app/package/Main.java']);
    expect(drawn[0]!.children?.[1]!.children?.map((node) => node.path))
      .toEqual(['com/java/other/deep/x.ts']);
  });
});

describe('takeEntry', () => {
  test('removes a root entry and hands it back', () => {
    const taken = takeEntry([file('a.ts'), file('b.ts')], {}, 'a.ts');

    expect(taken.entry?.path).toBe('a.ts');
    expect(taken.nodes.map((node) => node.path)).toEqual(['b.ts']);
  });

  test('removes a nested entry from its parent cache', () => {
    const taken = takeEntry([folder('src')], { src: [file('src/a.ts'), file('src/b.ts')] }, 'src/a.ts');

    expect(taken.entry?.path).toBe('src/a.ts');
    expect(taken.cache.src?.map((node) => node.path)).toEqual(['src/b.ts']);
  });

  test('a path the tree does not carry reports no entry and changes nothing', () => {
    const cache = { src: [file('src/a.ts')] };
    const taken = takeEntry([folder('src')], cache, 'src/hidden.ts');

    expect(taken.entry).toBeNull();
    expect(taken.cache).toBe(cache);
  });
});

describe('renameEntryAt', () => {
  test('re-points the node and every descendant', () => {
    const tree = [folder('src', [folder('src/lib', [file('src/lib/a.ts')])])];
    const moved = renameEntryAt(tree, 'src', 'lib');

    expect(moved[0].path).toBe('lib');
    expect(moved[0].name).toBe('lib');
    expect(moved[0].children?.[0].path).toBe('lib/lib');
    expect(moved[0].children?.[0].children?.[0].path).toBe('lib/lib/a.ts');
  });

  test('a sibling whose path merely shares a prefix is left alone', () => {
    const tree = [file('src.ts'), file('src/a.ts')];
    const moved = renameEntryAt(tree, 'src', 'lib');

    expect(moved[0]).toBe(tree[0]);
    expect(moved[1].path).toBe('lib/a.ts');
  });

  test('a file rename updates its own name', () => {
    const moved = renameEntryAt([file('a.ts')], 'a.ts', 'nested/b.ts');

    expect(moved[0].path).toBe('nested/b.ts');
    expect(moved[0].name).toBe('b.ts');
  });
});

describe('rekeyCache', () => {
  test('moves the folder key and every key beneath it', () => {
    const cache = { src: [folder('src/lib')], 'src/lib': [file('src/lib/a.ts')], other: [file('other/x.ts')] };
    const moved = rekeyCache(cache, 'src', 'app');

    expect(Object.keys(moved).sort()).toEqual(['app', 'app/lib', 'other']);
    expect(moved['app/lib']?.[0].path).toBe('app/lib/a.ts');
    expect(moved.other).toBe(cache.other);
  });
});

describe('rekeyExpansion', () => {
  test('an open folder and its open children stay open under their new paths', () => {
    const next = rekeyExpansion(new Set(['src', 'src/lib', 'docs']), 'src', 'app');

    expect([...next].sort()).toEqual(['app', 'app/lib', 'docs']);
  });

  test('a path that only shares a prefix is untouched', () => {
    const next = rekeyExpansion(new Set(['src.ts']), 'src', 'app');

    expect([...next]).toEqual(['src.ts']);
  });
});

describe('sortEntries', () => {
  test('folders first, then by name — the server’s own order', () => {
    const sorted = sortEntries([file('b.ts'), folder('z'), file('a.ts'), folder('a')]);

    expect(sorted.map((node) => node.path)).toEqual(['a', 'z', 'a.ts', 'b.ts']);
  });
});

describe('path helpers', () => {
  test('parentPathOf and baseNameOf split a nested path', () => {
    expect(parentPathOf('lib/deep/a.ts')).toBe('lib/deep');
    expect(parentPathOf('a.ts')).toBe('.');
    expect(baseNameOf('lib/deep/a.ts')).toBe('a.ts');
    expect(baseNameOf('a.ts')).toBe('a.ts');
  });
});
