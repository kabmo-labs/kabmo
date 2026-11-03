/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The badge's arithmetic, on the chunks the merge view already built.
 *
 * `countChunks` replaced a `Chunk.build` of the same pair inside the panel, so
 * the thing worth pinning is that it answers the same numbers from a chunk list
 * the caller hands it — an edit counts on BOTH sides, an insertion only on the
 * new one, and the hunks' line spans are read from their own documents rather
 * than assumed to be one line each.
 */

import { describe, expect, test } from 'bun:test';
import { Chunk } from '@codemirror/merge';
import { Text } from '@codemirror/state';

import { countChunks } from '@/client/components/workspace/diff-panel/changes';

function count(original: string[], next: string[]) {
  const a = Text.of(original);
  const b = Text.of(next);
  return countChunks(a, b, Chunk.build(a, b));
}

describe('countChunks', () => {
  test('an edited line is one deletion and one addition', () => {
    expect(count(['one', 'two', 'three'], ['one', 'TWO', 'three'])).toEqual({
      additions: 1,
      deletions: 1,
    });
  });

  test('a pure insertion counts additions only, and a pure deletion the opposite', () => {
    expect(count(['one', 'three'], ['one', 'two', 'three'])).toEqual({ additions: 1, deletions: 0 });
    expect(count(['one', 'two', 'three'], ['one', 'three'])).toEqual({ additions: 0, deletions: 1 });
  });

  test('a multi-line hunk counts every line it covers, not one per chunk', () => {
    expect(count(['a', 'b', 'c', 'd', 'e'], ['a', 'B', 'C', 'D', 'e'])).toEqual({
      additions: 3,
      deletions: 3,
    });
  });

  test('identical documents have no chunks and count zero', () => {
    expect(count(['same', 'lines'], ['same', 'lines'])).toEqual({ additions: 0, deletions: 0 });
  });
});
