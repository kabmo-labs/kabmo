/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Join and trim, the two line operations CodeMirror does not ship.
 *
 * The rules worth pinning are the ones a naive splice gets wrong: a collapsed caret
 * joins its own line with the NEXT one (the chord's meaning when nothing is
 * selected), a selection ending on a line boundary does not touch that line, and a
 * joined method chain must not gain a space before its `.`.
 */

import { describe, expect, test } from 'bun:test';
import { EditorState, type StateCommand } from '@codemirror/state';

import { joinLines, trimTrailingWhitespace } from '@/client/components/common/code-surface/line-commands';

/**
 * Run a `StateCommand` against a bare `{ state, dispatch }`, the way CM6 does.
 *
 * A `StateCommand` receives a `Transaction` (not a spec), so the dispatch only has to
 * adopt its `.state` — the shape `EditorView.dispatch` ultimately takes.
 */
function run(command: StateCommand, doc: string, anchor: number, head = anchor) {
  const view = {
    state: EditorState.create({ doc, selection: { anchor, head } }),
    dispatch(transaction: { state: EditorState }) {
      view.state = transaction.state;
    },
  };
  const handled = command(view as never);
  return { handled, doc: view.state.doc.toString() };
}

describe('joinLines', () => {
  test('a collapsed caret joins its line with the next one', () => {
    expect(run(joinLines, 'const a = 1;\nconst b = 2;', 5)).toEqual({
      handled: true,
      doc: 'const a = 1; const b = 2;',
    });
  });

  test('a method chain keeps its dot hugging the previous token', () => {
    // The rule: the joined line's indentation goes, and no space is inserted before a
    // character that should hug its predecessor.
    expect(run(joinLines, 'foo()\n  .bar()', 2).doc).toBe('foo().bar()');
    expect(run(joinLines, 'foo(\n  )', 4).doc).toBe('foo()');
  });

  test('two statements are separated by one space', () => {
    expect(run(joinLines, 'let a = 1\nlet b = 2', 3).doc).toBe('let a = 1 let b = 2');
  });

  test('a selection joins every line it covers, and stops at a boundary', () => {
    // `0..3` covers "a\nb\n", which touches lines 1 and 2 — line 3 starts at 4.
    expect(run(joinLines, 'a\nb\nc', 0, 3).doc).toBe('a b\nc');
  });

  test('the last line has nothing to join, and the chord is inert', () => {
    expect(run(joinLines, 'a\nb', 2)).toEqual({ handled: false, doc: 'a\nb' });
  });

  test('a single-line document is inert', () => {
    expect(run(joinLines, 'only', 1).handled).toBe(false);
  });

  test('joining across a blank line drops the blank line', () => {
    expect(run(joinLines, 'a\n\nb', 1).doc).toBe('a\nb');
  });
});

describe('trimTrailingWhitespace', () => {
  test('strips spaces and tabs from the lines the selection touches', () => {
    expect(run(trimTrailingWhitespace, 'a  \nb\t\nc', 0, 8).doc).toBe('a\nb\nc');
  });

  test('a collapsed caret trims only its own line', () => {
    expect(run(trimTrailingWhitespace, 'a  \nb  ', 0).doc).toBe('a\nb  ');
  });

  test('nothing to trim answers false, so the chord is inert rather than a no-op edit', () => {
    expect(run(trimTrailingWhitespace, 'a\nb', 0, 3)).toEqual({ handled: false, doc: 'a\nb' });
  });

  test('indentation is never touched — only the trailing run', () => {
    expect(run(trimTrailingWhitespace, '  a  ', 0).doc).toBe('  a');
  });
});
