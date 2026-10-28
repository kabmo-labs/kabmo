/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Merge-conflict markers, painted where the reader actually meets them.
 *
 * The diff panel has known about conflicts since `ConflictBanner`, but the
 * EDITOR — where a conflict is resolved by hand — showed `<<<<<<< HEAD` as an
 * ordinary line of text. A reader scrolling a conflicted file had no signal that
 * the block under the caret was two versions of the same code.
 *
 * ## `=======` is deliberately not painted
 *
 * A bare seven-`=` line is also a Markdown setext underline and appears in ASCII
 * banners — including this repository's own comment headers. Painting every one
 * of them would put a conflict band in files that have no conflict, which is
 * worse than painting nothing: the three markers below are unambiguous, and a
 * block is still legible without its separator.
 *
 * ## A viewport walk, not `MatchDecorator`
 *
 * The band has to be a LINE decoration, and a line decoration must be added at
 * `line.from` with an EMPTY range. `MatchDecorator` adds whatever its callback
 * returns over the MATCHED RANGE, so a `Decoration.line` coming out of it is
 * placed over `<<<<<<< HEAD`'s seven-to-twelve characters — measured in a real
 * browser: the marker lines rendered as blank rows (`<br>`) while the document
 * still held their text, i.e. the line's content was swallowed by a decoration
 * that should not have covered it.
 *
 * The walk below is the shape `indent-guide.ts` uses: visible lines only,
 * rebuilt on scroll and on edit, so a 20 MB file costs the viewport.
 */

import type { Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';

/** The marker that opens a block. Its count is the file's conflict count. */
export const OURS_MARK = '<<<<<<<';

/** diff3's base section header. */
export const BASE_MARK = '|||||||';

/** The marker that closes a block. */
export const THEIRS_MARK = '>>>>>>>';

/**
 * One of the three unambiguous markers, alone on its line apart from an optional
 * label (`<<<<<<< HEAD`, `>>>>>>> feature/x`).
 */
const MARKER_LINE = /^(?:<{7}|\|{7}|>{7})(?: .*)?$/;

const OURS_LINE = Decoration.line({ class: 'cm-conflict-ours' });
const BASE_LINE = Decoration.line({ class: 'cm-conflict-base' });
const THEIRS_LINE = Decoration.line({ class: 'cm-conflict-theirs' });

/** The band a line's text calls for, or null for every other line. */
function markerDecorationFor(text: string): Decoration | null {
  if (!MARKER_LINE.test(text)) return null;
  if (text.startsWith(BASE_MARK)) return BASE_LINE;
  if (text.startsWith(THEIRS_MARK)) return THEIRS_LINE;
  return OURS_LINE;
}

/** The bands for the lines currently rendered. */
function buildMarkers(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    let position = from;
    while (position <= to) {
      const line = view.state.doc.lineAt(position);
      const decoration = markerDecorationFor(line.text);
      // `Decoration.line` is a LINE decoration: one per line, at its own start,
      // and the set must be sorted — which walking the document already gives.
      if (decoration) ranges.push(decoration.range(line.from));
      if (line.to === position && line.to === view.state.doc.length) break;
      position = line.to + 1;
    }
  }
  return Decoration.set(ranges, true);
}

/**
 * The marker bands, as a view plugin.
 *
 * A plugin rather than a state field for the same reason `indentGuides` is: the
 * bands are derived from what is RENDERED, so a scroll has to rebuild them, and
 * a field would hold a decoration set the document does not own.
 */
export function conflictMarkers() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildMarkers(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildMarkers(update.view);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

/**
 * Whether the text holds at least one opening conflict marker at a line start.
 *
 * One scan with `indexOf`, stopping at the first hit: this runs before every
 * parse of a config file, so the common case — a file with no conflict — has to
 * be one native search rather than a pattern match over the whole buffer.
 */
export function hasConflictMarker(text: string): boolean {
  let index = text.indexOf(OURS_MARK);
  while (index !== -1) {
    if (index === 0 || text.charCodeAt(index - 1) === 10) return true;
    index = text.indexOf(OURS_MARK, index + OURS_MARK.length);
  }
  return false;
}

/**
 * How many conflict blocks the text holds.
 *
 * Counted with `indexOf` rather than a regex because this runs from a status
 * readout on every render, and the honest answer for the common case — a file
 * with no conflict at all — has to be one native scan, not a pattern match over
 * the whole buffer.
 */
export function countConflicts(text: string): number {
  let count = 0;
  let index = text.indexOf(OURS_MARK);
  while (index !== -1) {
    // A marker is a LINE start, not any occurrence: `"a <<<<<<< b"` is a string
    // literal, not a conflict.
    if (index === 0 || text.charCodeAt(index - 1) === 10) count++;
    index = text.indexOf(OURS_MARK, index + OURS_MARK.length);
  }
  return count;
}
