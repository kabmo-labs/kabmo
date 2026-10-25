/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The indent fold rule, and the two ways it can be wrong.
 *
 * This surface has no lezer parser, so folding is answered from indentation
 * alone. That makes the RULE the whole feature: a wrong boundary folds the next
 * function into this one, and a missing cap turns one gutter repaint into a walk
 * over half a million lines.
 *
 * The assertions are on `indentFoldRange` rather than on a rendered gutter
 * because the rule is the contract; `extensions.test.ts` mounts the real stack
 * and checks that CM6's own `foldable()` agrees with it.
 */

import { describe, expect, test } from 'bun:test';
import { EditorState } from '@codemirror/state';

import { indentFoldRange, MAX_FOLD_LINES } from '@/client/components/common/code-surface/fold';

function stateOf(doc: string): EditorState {
  return EditorState.create({ doc });
}

/** The fold for line `number` (1-based), as `[startLine, endLine]` or null. */
function foldAt(state: EditorState, number: number): [number, number] | null {
  const line = state.doc.line(number);
  const range = indentFoldRange(state, line.from, line.to);
  if (!range) return null;
  return [state.doc.lineAt(range.from).number, state.doc.lineAt(range.to).number];
}

describe('indentFoldRange', () => {
  test('a block folds up to the last line indented deeper than its opener', () => {
    const state = stateOf('function f() {\n  a();\n  b();\n}\nafter();\n');
    expect(foldAt(state, 1)).toEqual([1, 3]);
  });

  test('a nested block folds to its OWN end, not the outer one', () => {
    const state = stateOf('function f() {\n  if (a) {\n    b();\n  }\n  return 1;\n}\n');
    // The outer block runs to line 5 — the last line indented deeper than the
    // opener, which is `  return 1;` (the closing brace dedents).
    expect(foldAt(state, 1)).toEqual([1, 5]);
    // The inner one stops at its own last child: line 4 is `  }`, at the same
    // width as line 2, so the block ends at line 3.
    expect(foldAt(state, 2)).toEqual([2, 3]);
  });

  test('a blank line does not end a block', () => {
    const state = stateOf('function f() {\n  a();\n\n  b();\n}\n');
    expect(foldAt(state, 1)).toEqual([1, 4]);
  });

  test('a line with nothing deeper after it is not foldable', () => {
    const state = stateOf('const a = 1;\nconst b = 2;\n');
    expect(foldAt(state, 1)).toBeNull();
    expect(foldAt(state, 2)).toBeNull();
  });

  test('a one-line block does not fold, because nothing is deeper', () => {
    // Deliberate: the rule measures indentation, and there is none. A grammar
    // would know `{ … }` is a block; this surface has no grammar.
    const state = stateOf('if (a) { b(); }\nnext();\n');
    expect(foldAt(state, 1)).toBeNull();
  });

  test('a blank line is never an opener', () => {
    const state = stateOf('\n  indented();\n');
    expect(foldAt(state, 1)).toBeNull();
  });

  test('the fold starts after the opener LINE, so the opener stays visible', () => {
    const state = stateOf('function f() {\n  a();\n}\n');
    const line = state.doc.line(1);
    const range = indentFoldRange(state, line.from, line.to);
    expect(range?.from).toBe(line.to);
  });

  test('the range ends at the last child line, not at the closing brace', () => {
    const doc = 'function f() {\n  a();\n}\n';
    const state = stateOf(doc);
    const range = indentFoldRange(state, 0, state.doc.line(1).to);
    expect(range?.to).toBe(state.doc.line(2).to);
  });

  test('a block that runs past the cap is REFUSED, not truncated', () => {
    // A truncated fold would end at a line the reader never chose. 200 000
    // indented lines is the shape that made this necessary (a generated JSON).
    const state = stateOf('function f() {\n' + '  x();\n'.repeat(MAX_FOLD_LINES + 100) + '}\n');
    expect(foldAt(state, 1)).toBeNull();
  });

  test('a block that fits the cap still folds', () => {
    const state = stateOf('function f() {\n' + '  x();\n'.repeat(50) + '}\n');
    expect(foldAt(state, 1)).toEqual([1, 51]);
  });

  test('a block that ends exactly at the document end is not mistaken for a capped one', () => {
    // The cap is `lastLine < doc.lines`; a block whose children reach the last
    // line must still fold, or every file without a trailing newline's tail
    // block would be unfolderable.
    const state = stateOf('function f() {\n  a();\n  b();');
    expect(foldAt(state, 1)).toEqual([1, 3]);
  });

  test('tabs count as indentation', () => {
    const state = stateOf('function f() {\n\ta();\n}\n');
    expect(foldAt(state, 1)).toEqual([1, 2]);
  });

  test('a sibling line at the same width means there is nothing to fold', () => {
    // The rule is strictly DEEPER. Two lines at the same indent are siblings,
    // so the first has no body of its own.
    const state = stateOf('  a();\n  b();\nc();\n');
    expect(foldAt(state, 1)).toBeNull();
  });

  test('a dedent after some children ends the block there', () => {
    const state = stateOf('  a();\n    b();\n  c();\nd();\n');
    expect(foldAt(state, 1)).toEqual([1, 2]);
  });

  test('yaml, python and json fold by the same rule', () => {
    // The point of indentation over a grammar: one rule, every language.
    const yaml = stateOf('services:\n  web:\n    image: nginx\n  db:\n    image: pg\nother: 1\n');
    // `services:` owns lines 2-5 (both service entries and both images).
    expect(foldAt(yaml, 1)).toEqual([1, 5]);
    expect(foldAt(yaml, 2)).toEqual([2, 3]);

    const python = stateOf('def f(a):\n    if a:\n        return 1\n    return 0\n\nclass C:\n    x = 1\n');
    expect(foldAt(python, 1)).toEqual([1, 4]);
    expect(foldAt(python, 2)).toEqual([2, 3]);

    const json = stateOf('{\n  "a": {\n    "b": 1\n  }\n}\n');
    expect(foldAt(json, 1)).toEqual([1, 4]);
    expect(foldAt(json, 2)).toEqual([2, 3]);
  });

  test('markdown folds nothing, because a flat list has no indentation', () => {
    const state = stateOf('# Title\n\n- a\n- b\n\n## Sub\n\ntext\n');
    for (let number = 1; number <= state.doc.lines; number++) {
      expect(foldAt(state, number)).toBeNull();
    }
  });
});
