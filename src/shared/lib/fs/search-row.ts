/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * How a search hit is split for rendering when a replacement is being typed.
 *
 * The search row shows the match, and once the replace field holds text it
 * shows what the line would become — the old text struck through and the new
 * text beside it, the way VS Code's search view does. The split lives here, as
 * pure arithmetic, because the row must not re-derive the ranges the server
 * already computed: a preview that disagrees with the offsets the editor is
 * pointed at is the failure this exists to prevent.
 *
 * The replacement is taken VERBATIM, not expanded: it is the template the user
 * typed, and showing `$1` in the preview while the write path expands it would
 * promise a line the file never receives. VS Code's own preview does the same.
 */

export type SearchRowSegmentKind = 'plain' | 'removed' | 'inserted';

export interface SearchRowSegment {
  text: string;
  kind: SearchRowSegmentKind;
}

/**
 * `content` split into plain runs, removed match runs and the inserted text
 * that follows each one.
 *
 * Ranges are assumed to be in document order and non-overlapping — the route
 * emits them that way — but an out-of-order or overlapping pair is skipped
 * rather than allowed to duplicate text: a malformed list must not make the row
 * render a line that is not the file's.
 */
export function replacePreviewSegments(
  content: string,
  ranges: readonly { start: number; end: number }[],
  replacement: string,
): SearchRowSegment[] {
  const segments: SearchRowSegment[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor || range.end <= range.start || range.end > content.length) continue;
    if (range.start > cursor) segments.push({ text: content.slice(cursor, range.start), kind: 'plain' });
    segments.push({ text: content.slice(range.start, range.end), kind: 'removed' });
    // An empty replacement inserts nothing: an empty `<ins>` would only add a
    // DOM node with no text for the row to show.
    if (replacement) segments.push({ text: replacement, kind: 'inserted' });
    cursor = range.end;
  }
  if (cursor < content.length) segments.push({ text: content.slice(cursor), kind: 'plain' });
  return segments;
}
