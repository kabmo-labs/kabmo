/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The bracket pair GUIDE: the vertical line from the caret's brace to its pair.
 *
 * `bracketMatching()` paints two characters and nothing between them. What a
 * reader actually needs on a 300-line block is the SPAN — where the block ends —
 * and that is a line decoration on every row in between.
 *
 * Three decisions, each because the alternative was measured and worse.
 *
 * **The guide is driven by the CARET, not by every pair in the viewport.** A
 * viewport-wide version (VS Code's `bracketPairGuides`) draws a rule for every
 * brace on screen: on a 337-line component that is dozens of overlapping lines,
 * which is the same noise as a permanently-on indent guide and hides the one
 * pair the reader is looking at. This shows the pair the caret is IN.
 *
 * **It reads `matchBrackets`, the same call `bracketMatching()` makes.** A second
 * pairing rule would eventually disagree with the highlight, and a guide that
 * points somewhere the highlight does not is worse than none.
 *
 * **Blank lines get no guide.** A rule through the blank line between two
 * functions reads as if the block continued through it; the gap is the signal.
 *
 * The cost is one decoration per line of the block, rebuilt on selection and
 * document changes — 4 decorations for a typical block, and the span is capped
 * by `MAX_GUIDE_LINES` so a 5 000-line block cannot turn a caret move into
 * thousands of ranges.
 */

import { RangeSetBuilder, type EditorState } from '@codemirror/state';
import { Decoration, ViewPlugin, type DecorationSet, type EditorView } from '@codemirror/view';
import { matchBrackets } from '@codemirror/language';

/**
 * How many lines a guide may span.
 *
 * A guide longer than this is not a block a reader is following, it is a
 * container whose closing brace is off screen — and drawing it would mean one
 * decoration per row of the whole file on every caret move.
 */
export const MAX_GUIDE_LINES = 400;

/**
 * The column the guide is drawn in: the opening brace's own, in CH.
 *
 * The line's text is indented, and the brace sits after whatever precedes it
 * (`function f() {`), so a rule at the line's left edge would point at nothing.
 * `ch` is right because the editor is monospace — measured: the surface sets
 * `font-family: inherit` from a host that carries Fira Code, so one character is
 * one `ch` on every row.
 */
function guideColumn(state: EditorState, openPos: number): number {
  const line = state.doc.lineAt(openPos);
  return openPos - line.from;
}

/**
 * The bracket pair the caret sits in, or null.
 *
 * Tries the four positions `bracketDeco` tries, in the same order, so the guide
 * and the highlight can never point at different pairs.
 */
export function bracketPairAt(state: EditorState): { open: number; close: number } | null {
  const head = state.selection.main.head;
  const attempts: Array<[number, 1 | -1]> = [
    [head, -1],
    [head - 1, 1],
    [head, 1],
    [head + 1, -1],
  ];
  for (const [pos, dir] of attempts) {
    if (pos < 0 || pos > state.doc.length) continue;
    const match = matchBrackets(state, pos, dir);
    if (match?.matched && match.end) {
      return { open: Math.min(match.start.from, match.end.from), close: Math.max(match.start.to, match.end.to) };
    }
  }
  return null;
}

/** One line decoration per row the pair spans, carrying its own column. */
function guideLine(column: number): Decoration {
  return Decoration.line({
    class: 'cm-bracket-guide',
    attributes: { style: `--bracket-guide-col: ${column}` },
  });
}

/** The guide decorations for a state. Exported so a test can assert the rule. */
export function bracketGuideDecorations(state: EditorState): DecorationSet {
  const pair = bracketPairAt(state);
  if (!pair) return Decoration.none;

  const openLine = state.doc.lineAt(pair.open);
  const closeLine = state.doc.lineAt(pair.close);
  // A one-line pair has nothing between its braces to connect.
  if (closeLine.number - openLine.number <= 1) return Decoration.none;
  if (closeLine.number - openLine.number > MAX_GUIDE_LINES) return Decoration.none;

  const column = guideColumn(state, pair.open);
  const decoration = guideLine(column);
  const builder = new RangeSetBuilder<Decoration>();
  for (let number = openLine.number + 1; number < closeLine.number; number++) {
    const line = state.doc.line(number);
    if (!line.text.trim()) continue;
    builder.add(line.from, line.from, decoration);
  }
  return builder.finish();
}

const guidePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = bracketGuideDecorations(view.state);
    }

    update(update: { docChanged: boolean; selectionSet: boolean; viewportChanged: boolean; state: EditorState }) {
      if (update.docChanged || update.selectionSet) this.decorations = bracketGuideDecorations(update.state);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** The guide, as one extension. */
export const bracketGuide = guidePlugin;
