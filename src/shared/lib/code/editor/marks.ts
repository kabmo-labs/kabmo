/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Find matches spliced into the highlighter's own markup.
 *
 * The find widget's highlights ride on the same layer the tokens do, so a mark
 * can never drift from the text it belongs to. That means walking each token's
 * content and inserting `<mark>` around the parts of it a match covers — a
 * match routinely spans several tokens (`const alpha` is three) and a token
 * routinely holds several matches.
 *
 * This is the markup path for the surfaces that render highlighted HTML (the
 * chat's excerpt cards, the search panel's rows, the wiki reader). The EDITOR no
 * longer uses it: CodeMirror draws its own decorations from a state field
 * (`code-surface/marks.ts`), which is what stopped every find result from
 * forcing a re-tokenize.
 *
 * `<mark>` is an INLINE element with a background and no padding or border, so
 * it paints without moving the glyphs it sits between — anything that changes
 * the box (a block display, a border, an outline with an offset) shifts the text
 * and breaks the alignment a caller's own layout depends on.
 *
 * Kept out of `syntax-highlight.ts` so the tokenizer module stays under the
 * repository's line ceiling and because this is the find feature's concern
 * inside the highlight pipeline, not the highlighter's.
 */

import { escapeCode } from '@/shared/lib/code/highlighter';
import type { FindMatch } from '@/shared/lib/code/editor/find-scan';

/**
 * How `highlightLines` paints its marks. Declared here rather than in the
 * highlighter because the marks ARE this module's concern; the highlighter
 * imports the type.
 */
export interface HighlightLinesOptions {
  /**
   * Lines at or above this length are emitted as plain text instead of being
   * tokenized — the guard a minified bundle (one line of hundreds of KB) needs.
   */
  maxLineLength?: number;
  /**
   * Match ranges (absolute offsets in `code`) to wrap in `<mark class="find-match">`.
   * The find widget's highlights ride on the same markup the tokens do, so a
   * match cannot drift from the text it belongs to — and an inline `<mark>`
   * paints a background without moving the glyphs it sits between.
   */
  marks?: readonly FindMatch[];
  /** Index into `marks` of the current match, marked `data-find-current`. */
  currentMark?: number;
}

export const MARK_OPEN = '<mark class="find-match">';
/** The current match is the one the caret/next-step is aimed at; the CSS paints it darker. */
export const MARK_CURRENT_OPEN = '<mark class="find-match" data-find-current="">';
/**
 * `content` with every intersecting mark spliced in, HTML-escaped.
 *
 * `tokenStart` is the token's absolute offset in the document; `marks` are in
 * document order, which is what lets the loop stop at the first mark that
 * begins after the token rather than scanning the whole list per token.
 */
export function tokenMarkup(
  content: string,
  tokenStart: number,
  marks: readonly FindMatch[] | undefined,
  currentMark: number,
): string {
  const tokenEnd = tokenStart + content.length;
  if (!marks || marks.length === 0) return escapeCode(content);
  let html = '';
  let cursor = 0;
  for (let index = 0; index < marks.length; index++) {
    const mark = marks[index];
    // Marks and tokens are both in document order: anything that ended before
    // this token cannot intersect it.
    if (mark.end <= tokenStart) continue;
    if (mark.start >= tokenEnd) break;
    // A zero-width range has no text to paint; emitting one produced an empty
    // `<mark></mark>`, which is invisible but still a DOM node per occurrence.
    if (mark.end <= mark.start) continue;
    const from = Math.max(mark.start, tokenStart) - tokenStart;
    const to = Math.min(mark.end, tokenEnd) - tokenStart;
    if (to <= cursor) continue;
    html += escapeCode(content.slice(cursor, from));
    const open = index === currentMark ? MARK_CURRENT_OPEN : MARK_OPEN;
    html += open + escapeCode(content.slice(from, to)) + '</mark>';
    cursor = to;
  }
  return html + escapeCode(content.slice(cursor));
}
