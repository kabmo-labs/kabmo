/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The caret's position, in the units a status bar prints.
 *
 * The phone has had a status strip since the editor was rebuilt; the desktop pane
 * had nothing, so the only way to know where the caret was is to count lines.
 *
 * ## Why this is computed from a `State` and not read from the DOM
 *
 * The surface's update listener writes `data-line` and `data-selection` on the
 * content element, and that attribute pair is documented as belonging to the e2e
 * layer — "nothing in the app reads them". A status bar built on it would make an
 * app feature depend on a test fixture. The surface therefore reports the caret
 * through its own prop, from the same listener, and this module is the arithmetic.
 *
 * ## Column is 1-based and counts CHARACTERS, not display columns
 *
 * A tab counts as one, which is what an editor's "Col" shows and what the user's own
 * selection arithmetic produces. Counting display columns would need the tab size
 * and the font, and would disagree with the number under their cursor.
 */

import type { EditorState } from '@codemirror/state';

/** Where the caret is, in the units the readout prints. */
export interface CaretPosition {
  /** 1-based line number. */
  line: number;
  /** 1-based character offset within the line. */
  column: number;
}

/** The caret's position in `state`. */
export function caretPositionOf(state: EditorState): CaretPosition {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  return { line: line.number, column: head - line.from + 1 };
}

/** Whether two positions print the same thing. */
export function sameCaret(a: CaretPosition | null, b: CaretPosition | null): boolean {
  if (a === null || b === null) return a === b;
  return a.line === b.line && a.column === b.column;
}
