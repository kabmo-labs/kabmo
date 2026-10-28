/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Line arithmetic, which the highlighter's per-line walk and the find widget's
 * "jump to line N" both read.
 *
 * The interesting cases are the two the arithmetic gets wrong by accident: the
 * empty line a trailing newline opens, and an offset past the end of the
 * document.
 */

import { describe, expect, test } from 'bun:test';

import { lineIndexAt, lineStartOffset } from '@/shared/lib/code/editor/lines';

describe('lineIndexAt and lineStartOffset', () => {
  test('are inverses for every line start', () => {
    const text = 'one\ntwo\n\nfour';
    // Line starts in `text`: 0, 4, 8 (the empty line) and 9.
    for (const offset of [0, 4, 8, 9]) {
      expect(lineStartOffset(text, lineIndexAt(text, offset))).toBe(offset);
    }
    expect(lineIndexAt(text, 13)).toBe(3);
  });

  test('clamp an offset past the end to the last line', () => {
    expect(lineIndexAt('one\ntwo', 999)).toBe(1);
    expect(lineStartOffset('one\ntwo', 99)).toBe(7);
  });
});
