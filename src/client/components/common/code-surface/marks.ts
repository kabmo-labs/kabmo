/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Find matches, as a decoration field.
 *
 * The old surface spliced `<mark>` elements into the highlighter's own HTML, so
 * every find result forced a re-tokenize of the window and the marks could not
 * exist without the token layer. A field is the CM6 shape: the ranges are state,
 * the decorations are derived from it, and a keystroke in the query costs one
 * rebuild of the ranges instead of a second trip through Shiki.
 *
 * The geometry rules are inherited from that markup layer and are still
 * load-bearing: `<mark>` had a background and no padding, and the current match
 * is marked with horizontal edges only. A match routinely spans several tokens,
 * so any decoration that draws vertical edges would paint a seam in the middle
 * of it.
 */

import { RangeSetBuilder, StateEffect, StateField, type Text } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

/** A document-offset range; the editor's own `TextRange` shape. */
export interface MarkRange {
  start: number;
  end: number;
}

export interface FindMarkState {
  marks: readonly MarkRange[];
  /** Index into `marks` of the match the caret is aimed at, or -1. */
  current: number;
}

/** Replace the whole mark set. */
export const setFindMarks = StateEffect.define<FindMarkState>();

const MATCH = Decoration.mark({ class: 'find-match' });
const CURRENT = Decoration.mark({ class: 'find-match', attributes: { 'data-find-current': '' } });

function build(state: FindMarkState, doc: Text): DecorationSet {
  if (state.marks.length === 0) return Decoration.none;
  const builder = new RangeSetBuilder<Decoration>();
  for (let index = 0; index < state.marks.length; index++) {
    const mark = state.marks[index];
    const from = Math.max(0, Math.min(mark.start, doc.length));
    const to = Math.max(from, Math.min(mark.end, doc.length));
    if (to === from) continue;
    builder.add(from, to, index === state.current ? CURRENT : MATCH);
  }
  return builder.finish();
}

/**
 * The mark set as editor state.
 *
 * A document edit MAPS the existing decorations rather than dropping them: the
 * owner recomputes the list on the next render anyway (`matches` is derived from
 * the live buffer), and mapping keeps the highlights roughly right for the frame
 * in between instead of blinking off on every keystroke.
 */
export const findMarksField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setFindMarks)) return build(effect.value, transaction.state.doc);
    }
    if (transaction.docChanged) return marks.map(transaction.changes);
    return marks;
  },
  provide: (field) => EditorView.decorations.from(field),
});
