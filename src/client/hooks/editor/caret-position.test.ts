/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The caret readout's arithmetic.
 *
 * Small, and every branch is a number the user reads: `Ln 1, Col 1` at the start of
 * the file, a column that counts a tab as one character (which is what every editor's
 * `Col` shows), and a `null` before the surface has reported anything — a readout
 * that printed `Ln 0, Col 0` would look like a position in an empty file.
 */

import { describe, expect, test } from 'bun:test';
import { EditorSelection, EditorState } from '@codemirror/state';

import { caretPositionOf, sameCaret } from '@/client/hooks/editor/caret-position';

function stateAt(doc: string, anchor: number): EditorState {
  return EditorState.create({ doc, selection: EditorSelection.single(anchor) });
}

describe('caretPositionOf', () => {
  test('the start of the file is line 1, column 1', () => {
    expect(caretPositionOf(stateAt('abc\ndef', 0))).toEqual({ line: 1, column: 1 });
  });

  test('a position mid-line counts characters from the line start', () => {
    expect(caretPositionOf(stateAt('abc\ndef', 6))).toEqual({ line: 2, column: 3 });
  });

  test('the very end of a line is its own column, not the next line', () => {
    expect(caretPositionOf(stateAt('abc\ndef', 3))).toEqual({ line: 1, column: 4 });
  });

  test('a tab counts as ONE character, which is what Col shows', () => {
    expect(caretPositionOf(stateAt('\tabc', 2))).toEqual({ line: 1, column: 3 });
  });

  test('the last line of a file with a trailing newline is an empty line 2', () => {
    expect(caretPositionOf(stateAt('a\n', 2))).toEqual({ line: 2, column: 1 });
  });
});

describe('sameCaret', () => {
  test('compares the two numbers, not the object identity', () => {
    expect(sameCaret({ line: 1, column: 2 }, { line: 1, column: 2 })).toBe(true);
    expect(sameCaret({ line: 1, column: 2 }, { line: 1, column: 3 })).toBe(false);
    expect(sameCaret({ line: 1, column: 2 }, { line: 2, column: 2 })).toBe(false);
  });

  test('two nulls are the same, and null against a position is not', () => {
    expect(sameCaret(null, null)).toBe(true);
    expect(sameCaret(null, { line: 1, column: 1 })).toBe(false);
    expect(sameCaret({ line: 1, column: 1 }, null)).toBe(false);
  });
});
