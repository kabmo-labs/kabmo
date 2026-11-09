/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';
import { buildSessionTree, descendantsOf } from '@/client/lib/session-tree';
import type { SessionItemData } from '@/shared/types';

function session(id: string, parentSessionId?: string): SessionItemData {
  return {
    id,
    folder_id: 1,
    title: id,
    ...(parentSessionId ? { parentSessionId } : {}),
  };
}

describe('buildSessionTree', () => {
  test('nests children under their parent and keeps orphans as roots', () => {
    const tree = buildSessionTree([
      session('root'),
      session('child', 'root'),
      session('grandchild', 'child'),
      session('orphan', 'missing'),
    ]);
    expect(tree.roots.map((row) => row.id)).toEqual(['root', 'orphan']);
    expect(tree.childrenOf.get('root')?.map((row) => row.id)).toEqual(['child']);
    expect(tree.childrenOf.get('child')?.map((row) => row.id)).toEqual(['grandchild']);
  });

  test('a self-parent is a root rather than an invisible row', () => {
    const tree = buildSessionTree([session('self', 'self')]);
    expect(tree.roots.map((row) => row.id)).toEqual(['self']);
  });

  test('descendants carry depth and stop at a cycle', () => {
    const childrenOf = new Map<string, SessionItemData[]>([
      ['a', [session('b', 'a')]],
      ['b', [session('c', 'b')]],
    ]);
    expect(descendantsOf('a', childrenOf).map((row) => [row.session.id, row.depth])).toEqual([
      ['b', 1],
      ['c', 2],
    ]);
    // A cycle is not walked forever.
    childrenOf.set('c', [session('a', 'c')]);
    expect(descendantsOf('a', childrenOf).map((row) => row.session.id)).toEqual(['b', 'c']);
  });
});
