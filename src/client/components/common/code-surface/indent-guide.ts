/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Indent guides, without a grammar.
 *
 * A vertical rule at every nesting level, drawn for the viewport only. This is the
 * feature that makes 4-space YAML and 2-space TS readable side by side, and it is the
 * one every editor has — but CM6 ships no grammar-free version, because its own
 * indent guides come from a syntax tree.
 *
 * ## It is NOT the bracket pair guide
 *
 * `bracket-guide.ts` draws ONE line between a brace and its match, at the opening
 * brace's own column. This draws one line PER LEVEL, at the indent columns. Two rules
 * that looked alike would teach the reader that the marks mean the same thing, so
 * this one is deliberately dimmer and sits at the column boundary rather than under a
 * character.
 *
 * ## The measurement is the line's leading whitespace, which is all there is
 *
 * With no tree, the only fact available is how far a line is indented. Two limits
 * follow, and both are stated rather than hidden:
 *
 * - A continuation line indented by ALIGNMENT (not nesting) gets a guide it should not
 *   have. Nothing textual can tell the two apart.
 * - A line indented by an odd number of spaces gets guides at each whole `indentUnit`,
 *   so the last partial level draws nothing.
 *
 * ## The cost bound is the viewport
 *
 * Only rendered lines are walked (`view.viewport`), and a line longer than
 * `MAX_GUIDE_COLUMNS` is skipped: a minified file is one 400 000-character line, and
 * counting its indentation per frame is work for a rule nobody can see.
 */

import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';

import { guideColumn } from '@/shared/lib/code/editor/indent-guide-rule';

/** One guide rule: a 1px border at the level's column. */
const guideMark = (column: number): Decoration =>
  Decoration.line({
    attributes: { style: `--indent-guide-col: ${column}ch` },
    class: 'cm-indent-guide',
  });

/**
 * The guide decorations for the lines currently rendered.
 *
 * `state.tabSize` and the indentation unit come from the state, so a 4-space setting
 * moves the guides with the code — no second setting to keep in step.
 */
function buildGuides(view: EditorView): DecorationSet {
  const unit = view.state.tabSize > 0 ? view.state.tabSize : 2;
  const builder: Array<{ line: number; decoration: Decoration }> = [];

  for (const { from, to } of view.visibleRanges) {
    let position = from;
    while (position <= to) {
      const line = view.state.doc.lineAt(position);
      // The RULE lives in `indent-guide-rule.ts` so it is testable without a view.
      const column = guideColumn(line.text, unit);
      if (column !== null) builder.push({ line: line.from, decoration: guideMark(column) });
      if (line.to === position && line.to === view.state.doc.length) break;
      position = line.to + 1;
    }
  }

  // `Decoration.line` is a LINE decoration: one per line, at its own start, and the
  // set must be sorted by position — which walking the document already gives.
  return Decoration.set(
    builder.map((entry) => entry.decoration.range(entry.line)),
    true,
  );
}

/**
 * The indent guides, as a view plugin.
 *
 * A plugin rather than a `StateField`: the guides are derived from what is RENDERED,
 * so they must rebuild on scroll as well as on edit, and a field would have to store
 * a decoration set the state does not own.
 */
export const indentGuides = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildGuides(view);
    }

    update(update: ViewUpdate) {
      // A scroll changes the viewport, which changes the guides; an edit changes the
      // text, which does too. Everything else (a selection move) cannot.
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildGuides(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
