/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Whitespace marks, drawn only where the text is SELECTED — VS Code's
 * `editor.renderWhitespace: 'selection'`, its default.
 *
 * ## Why the selection, and not the document
 *
 * An always-on mark is a permanent dotted layer over every block in a file: it
 * competes with the code it was meant to explain, and it answers a question
 * nobody asked until they started caring about the bytes. Painting the marks on
 * the selection answers it at the moment it is asked — a drag across a block, or
 * `⇧⌘→` over a line — and leaves the rest of the document as code. The package's
 * own `highlightWhitespace()` marks every space in the viewport; a leading-run
 * version marks every block's indentation. Both were tried and both are noise.
 *
 * ## Two bounds keep it cheap
 *
 * - Only SELECTED characters are considered, so a caret (`empty` range) paints
 *   nothing — which is also what makes thousands of `⌘D` cursors free.
 * - Only the selection's intersection with the VIEWPORT is walked, so `⌘A` on a
 *   20 MB file costs the lines on screen rather than the document.
 *
 * ## It is NOT an indent guide
 *
 * Nothing here draws a vertical rule per nesting level — that feature was
 * removed, because a column of rules read as structure the file does not have.
 */

import type { EditorState, SelectionRange } from '@codemirror/state';
import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';

/** The two characters a mark is drawn for; a line break is not one of them. */
const KINDS = {
  ' ': Decoration.mark({ class: 'cm-whitespace-space' }),
  '\t': Decoration.mark({ class: 'cm-whitespace-tab' }),
} as const;

type WhitespaceChar = keyof typeof KINDS;

/**
 * Marks every space and tab in `[from, to)`.
 *
 * One mark per CHARACTER, not per run: a mark's box is what the CSS paints, and
 * a single span over four spaces can hold only one dot (`no-repeat` at `.4em`).
 * Per-character ranges are what make four spaces draw four dots.
 */
function addSlice(state: EditorState, from: number, to: number, builder: RangeSetBuilder<Decoration>): void {
  let line = state.doc.lineAt(from);
  for (;;) {
    const start = Math.max(from, line.from);
    const end = Math.min(to, line.to);
    for (let offset = start; offset < end; offset++) {
      const kind = line.text[offset - line.from] as WhitespaceChar;
      // Anything else — a newline, or the file's content — is not a mark.
      if (kind === ' ' || kind === '\t') builder.add(offset, offset + 1, KINDS[kind]);
    }
    if (line.to >= to || line.to >= state.doc.length) break;
    line = state.doc.lineAt(line.to + 1);
  }
}

/**
 * The marks for one selection range, clipped to the window `[windowFrom, windowTo)`.
 *
 * The clip is the viewport, which is the bound that makes a whole-document
 * selection cheap: a mark outside the rendered lines could not be seen.
 */
function addRange(
  state: EditorState,
  range: SelectionRange,
  windowFrom: number,
  windowTo: number,
  builder: RangeSetBuilder<Decoration>,
): void {
  const from = Math.max(range.from, windowFrom);
  const to = Math.min(range.to, windowTo);
  // A caret, or a selection entirely outside the window: nothing to paint.
  if (from >= to) return;
  addSlice(state, from, to, builder);
}

/**
 * The whitespace marks for `ranges`, in document order.
 *
 * `window` defaults to the whole document, which is what a caller that has no
 * view (a test) wants; the plugin passes its viewport, because that is the only
 * part of a selection that can be seen.
 */
export function whitespaceDecorations(
  state: EditorState,
  ranges: readonly SelectionRange[] = state.selection.ranges,
  window: { from: number; to: number } = { from: 0, to: state.doc.length },
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of ranges) {
    // CodeMirror keeps selection ranges ascending, and the window is one span,
    // so appending as we go yields a sorted set.
    addRange(state, range, window.from, window.to, builder);
  }
  return builder.finish();
}

/**
 * The whitespace marks, as a view plugin.
 *
 * Rebuilt on a SELECTION change as well as on an edit or a scroll: the marks are
 * a function of the selection AND of what is rendered, so collapsing the
 * selection is what removes them and scrolling is what produces them elsewhere.
 */
export const whitespaceMarks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = this.build(update.view);
      }
    }

    private build(view: EditorView): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>();
      for (const { from, to } of view.visibleRanges) {
        for (const range of view.state.selection.ranges) {
          if (!range.empty) addRange(view.state, range, from, to, builder);
        }
      }
      return builder.finish();
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
