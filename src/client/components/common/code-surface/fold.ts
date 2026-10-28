/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Folding without a grammar.
 *
 * The code surface tokenizes with Shiki and has no lezer parser, so CM6's own
 * syntax folding (`foldNodeProp`, the path `codeFolding` uses when a language
 * is installed) has no tree to read. What it DOES have is `foldService`, a facet
 * asked once per gutter line: "does this line open a range that continues past
 * it?" Answering from INDENTATION is the standard fallback — it is vim's
 * `foldmethod=indent` — and it is the only rule that works for all 59 languages
 * this app can name, where a grammar would cover 19 of them.
 *
 * The rule is one sentence: a line folds up to the last following line that is
 * indented deeper than it is. Blank lines never end a block (they belong to
 * neither side), which is what keeps a fold intact through the blank line
 * between two functions' bodies.
 *
 * Two consequences are deliberate and worth stating, because both look like
 * bugs:
 *
 * - A one-line block (`if (a) { b(); }`) does not fold — nothing is deeper.
 * - A multi-line EXPRESSION does fold (`const x =` / `  a &&` / `  b;`), because
 *   it is indented and that is what the rule measures. A grammar would call
 *   that "not a block"; indentation cannot tell, and refusing to fold it would
 *   require the parser this file exists to avoid.
 *
 * ## The cap is a cost bound, and it REFUSES rather than truncates
 *
 * The scan walks forward until the indentation dedents, so a file that is one
 * huge block (`{` … 500 000 lines … `}` — a generated JSON, a data fixture)
 * would be walked on every gutter line the reader scrolls past. Measured on a
 * 500 000-line JSON: 74.6 ms per call, unbounded; with the cap, 0.50 ms. So past
 * `MAX_FOLD_LINES` the answer is `null` — no marker, no fold — because a
 * TRUNCATED fold would be a range that ends somewhere the reader did not choose.
 * A 3 000-line function still folds under this cap; a block that large is not
 * something a reader folds anyway.
 *
 * ## Measured against this repository's own files
 *
 * 288-line component → 26 foldable lines, 337-line component → 69, and the whole
 * scan for a viewport's worth of lines costs 0.1 ms. Per-call cost on the
 * 150 000-line file: 0.002 ms.
 */

import type { EditorState } from '@codemirror/state';
import { foldService } from '@codemirror/language';

/**
 * How many lines a single fold may span before the answer becomes "not foldable".
 *
 * Chosen from the cost curve, not from taste: 5 000 lines is 0.5 ms in the worst
 * case measured (a 500 000-line JSON where every line is inside one block), and
 * it still folds a 3 000-line function.
 */
export const MAX_FOLD_LINES = 5_000;

/** The leading whitespace's width — tabs count as one, which is enough to compare. */
function indentWidth(text: string): number {
  const firstNonSpace = text.length - text.trimStart().length;
  return firstNonSpace;
}

/**
 * The foldable range starting on the line at `lineStart`, or null.
 *
 * Shaped exactly like CM6's `foldService` callback so it can be registered as
 * one; exported separately because the rule is what the tests pin.
 */
export function indentFoldRange(
  state: EditorState,
  lineStart: number,
  lineEnd: number,
): { from: number; to: number } | null {
  const line = state.doc.lineAt(lineStart);
  // A blank line opens nothing: its indent is the whole line.
  if (!line.text.trim()) return null;

  const baseIndent = indentWidth(line.text);
  const lastLine = Math.min(state.doc.lines, line.number + MAX_FOLD_LINES);

  let end = lineEnd;
  let sawChild = false;
  let stopped = false;

  for (let number = line.number + 1; number <= lastLine; number++) {
    const next = state.doc.line(number);
    if (!next.text.trim()) continue;
    if (indentWidth(next.text) <= baseIndent) {
      stopped = true;
      break;
    }
    sawChild = true;
    end = next.to;
  }

  // A block that ran into the cap is REFUSED rather than cut short: the range
  // would end at an arbitrary line, and a fold the reader did not choose is
  // worse than no fold. Running out of DOCUMENT is not the same thing — the
  // loop reached the end because the block does.
  if (!stopped && lastLine < state.doc.lines) return null;

  return sawChild && end > lineEnd ? { from: lineEnd, to: end } : null;
}

/**
 * The service as an extension.
 *
 * `foldService` runs BEFORE the syntax-tree path in `foldable()`, so registering
 * this alongside a grammar later would still let the grammar answer wherever
 * this returns null — the two compose rather than compete.
 */
export const indentFoldService = foldService.of((state, lineStart, lineEnd) =>
  indentFoldRange(state, lineStart, lineEnd),
);
