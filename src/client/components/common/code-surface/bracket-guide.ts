/**
 * @license
 * SPDX-License-Identifier: MIT
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
 * **The rule hangs from the LEFTMOST brace of the pair.** One straight line
 * cannot meet two braces in different columns, and the common shapes put them
 * far apart: `const config = merge(base, {` opens at column 30 and closes at
 * column 0, so a rule at the opener's column points at nothing on every row in
 * between while the brace it is meant to reach sits at the left edge. Taking
 * the smaller of the two is what makes the line land on a brace a reader can
 * see, whichever of the pair that is.
 *
 * The cost is one decoration per line of the block, rebuilt on selection and
 * document changes — 4 decorations for a typical block, and the span is capped
 * by `MAX_GUIDE_LINES` so a 5 000-line block cannot turn a caret move into
 * thousands of ranges.
 */

import { countColumn, RangeSetBuilder, type EditorState } from '@codemirror/state';
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

/** The column a position occupies on its line, in character cells. */
function columnOf(state: EditorState, pos: number): number {
  const line = state.doc.lineAt(pos);
  // `countColumn`, not `pos - line.from`: a literal tab advances to the next tab
  // stop, and CM6 writes `tab-size: state.tabSize` on `.cm-content`, so cells —
  // not code units — are what `ch` measures.
  return countColumn(line.text, state.tabSize, pos - line.from);
}

/**
 * The column the guide is drawn in: the LEFTMOST of the pair's two braces.
 *
 * One vertical rule cannot meet two braces that sit in different columns, so it
 * hangs from whichever is further left. `const config = merge(base, {` opens at
 * column 30 and closes at column 0; a rule at 30 points at nothing on every row
 * between, while the brace it is meant to reach sits at the left edge. Taking
 * the minimum is what makes the rule land on the brace a reader can see.
 */
function guideColumn(state: EditorState, pair: { open: number; close: number }): number {
  // `pair.close` is the offset just PAST the closing brace, so the brace itself
  // is one code unit back.
  return Math.min(columnOf(state, pair.open), columnOf(state, pair.close - 1));
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

  const column = guideColumn(state, pair);
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
