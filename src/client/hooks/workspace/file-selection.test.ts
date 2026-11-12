/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Files panel's selection arithmetic: what a modifier means, which rows a
 * shift-range covers, and the flat order the range is computed against.
 *
 * The range is the one rule that can be wrong without looking wrong: a range
 * computed from the TREE instead of the DRAWN rows selects collapsed children
 * the user never saw, and a range whose anchor disappeared must not select the
 * whole tree.
 */

import { describe, expect, test } from 'bun:test';
import { rangePaths, selectionGestureOf, visibleEntriesOf, type SelectionNode } from '@/client/hooks/workspace/file-selection';

const node = (path: string, type: 'file' | 'folder', children?: SelectionNode[]): SelectionNode => ({
  path,
  name: path.split('/').pop() ?? path,
  type,
  children,
});

describe('selectionGestureOf', () => {
  test('shift ranges, meta or ctrl toggles, otherwise plain', () => {
    expect(selectionGestureOf({ shiftKey: true, metaKey: true, ctrlKey: true })).toBe('range');
    expect(selectionGestureOf({ metaKey: true })).toBe('toggle');
    expect(selectionGestureOf({ ctrlKey: true })).toBe('toggle');
    expect(selectionGestureOf({})).toBe('plain');
  });
});

describe('rangePaths', () => {
  const order = ['a.ts', 'b.ts', 'c.ts', 'd.ts'];

  test('covers both ends regardless of direction', () => {
    expect(rangePaths(order, 'b.ts', 'd.ts')).toEqual(['b.ts', 'c.ts', 'd.ts']);
    expect(rangePaths(order, 'd.ts', 'b.ts')).toEqual(['b.ts', 'c.ts', 'd.ts']);
  });

  test('falls back to the target when the anchor is gone from the visible rows', () => {
    // A collapsed folder's anchor is no longer drawn; selecting the rest of the
    // tree because of that would be worse than selecting only the click.
    expect(rangePaths(order, 'gone.ts', 'c.ts')).toEqual(['c.ts']);
    expect(rangePaths(order, null, 'c.ts')).toEqual(['c.ts']);
  });
});

describe('visibleEntriesOf', () => {
  const tree: SelectionNode[] = [
    node('src', 'folder', [node('src/a.ts', 'file'), node('src/deep', 'folder', [node('src/deep/b.ts', 'file')])]),
    node('readme.md', 'file'),
  ];

  test('an open folder contributes its children immediately after it', () => {
    const entries = visibleEntriesOf(tree, (entry) => entry.type === 'folder');
    expect(entries.map((entry) => entry.path)).toEqual(['src', 'src/a.ts', 'src/deep', 'src/deep/b.ts', 'readme.md']);
    expect(entries.find((entry) => entry.path === 'src/deep/b.ts')?.depth).toBe(2);
  });

  test('a closed folder contributes only itself', () => {
    const entries = visibleEntriesOf(tree, () => false);
    expect(entries.map((entry) => entry.path)).toEqual(['src', 'readme.md']);
  });
});
