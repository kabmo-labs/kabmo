/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Two line operations CodeMirror does not ship: join lines and trim trailing
 * whitespace.
 *
 * `@codemirror/commands` has `moveLineUp`, `copyLineUp`, `deleteLine` and the rest,
 * but no join — so this is written rather than wired. Both commands operate on the
 * SELECTION's lines (or the caret's line when nothing is selected), which is what
 * every editor means by them, and both are one undoable transaction.
 *
 * ## Join has to decide what to do about indentation
 *
 * The naive `from, to` splice leaves the second line's leading whitespace in the
 * middle of the result: `foo()` + `  .bar()` becomes `foo()  .bar()`. That is right
 * for a method chain and wrong for two statements, and a command cannot tell them
 * apart. The rule taken: strip the joined line's indentation, and put ONE space
 * between the halves unless the next line starts with a character that should hug its
 * predecessor (`.`, `,`, `)`, `]`, `}`, `;`, `:`). That keeps a chain readable
 * without inventing a second space in `foo() .bar()`.
 *
 * ## Trim is the one that changes a file the user did not ask about
 *
 * It is therefore an explicit command, never a format-on-save: trailing whitespace
 * can be significant (a Markdown hard break is two spaces, and a Makefile recipe line
 * ends in a tab). Documented in the command's own doc rather than left to surprise.
 */

import { type ChangeSpec, type EditorState, type StateCommand } from '@codemirror/state';

/** Characters that should not be preceded by a space when two lines are joined. */
const HUGS_PREVIOUS = new Set(['.', ',', ')', ']', '}', ';', ':']);

/**
 * The lines the selection touches, as `[first, last]` line numbers.
 *
 * A selection ENDING at the very start of a line does not touch that line — the same
 * rule a cut uses, and the reason `⌘⌥J` on line 1 of a two-line file joins it with
 * line 2 rather than reporting that there is nothing to join.
 */
function selectedLines(state: EditorState): { first: number; last: number } {
  const range = state.selection.main;
  const first = state.doc.lineAt(range.from).number;
  // A collapsed selection touches exactly its own line; a range that ends on a line
  // boundary stops at the line BEFORE it.
  const lastLine = state.doc.lineAt(range.to);
  const last = range.to > range.from && lastLine.from === range.to ? lastLine.number - 1 : lastLine.number;
  return { first, last: Math.max(first, last) };
}

/**
 * Join every line the selection touches into one.
 *
 * A single-line selection with nothing to join returns `false`, so the chord is
 * inert rather than eating the key.
 */
export const joinLines: StateCommand = ({ state, dispatch }) => {
  const range = state.selection.main;
  const collapsed = range.from === range.to;
  const { first, last } = selectedLines(state);
  // A COLLAPSED caret joins its own line with the next one — that is what the chord
  // means when nothing is selected. A RANGE joins the lines it covers.
  const lastToJoin = collapsed ? first + 1 : last;
  if (lastToJoin <= first || lastToJoin > state.doc.lines) return false;
  const lastLine = lastToJoin;

  const changes: ChangeSpec[] = [];
  for (let number = first; number < lastLine; number++) {
    const line = state.doc.line(number);
    const next = state.doc.line(number + 1);
    const trimmed = next.text.replace(/^[ \t]+/, '');
    // A blank line becomes a single space, not a collapse: joining across a paragraph
    // break should leave the words separated.
    const separator = trimmed === '' || HUGS_PREVIOUS.has(trimmed[0]) ? '' : ' ';
    changes.push({ from: line.to, to: next.from + (next.text.length - trimmed.length), insert: separator });
  }
  dispatch(state.update({ changes, scrollIntoView: true, userEvent: 'input.join' }));
  return true;
};

/**
 * Strip trailing whitespace from every line the selection touches.
 *
 * Returns `false` when there was nothing to trim, so a caller (and the chord) can
 * tell "done" from "nothing to do".
 */
export const trimTrailingWhitespace: StateCommand = ({ state, dispatch }) => {
  const { first, last } = selectedLines(state);
  const changes: ChangeSpec[] = [];
  for (let number = first; number <= last; number++) {
    const line = state.doc.line(number);
    const trimmed = line.text.replace(/[ \t]+$/, '');
    if (trimmed !== line.text) {
      changes.push({ from: line.from + trimmed.length, to: line.to, insert: '' });
    }
  }
  if (changes.length === 0) return false;
  dispatch(state.update({ changes, userEvent: 'input.trim' }));
  return true;
};
