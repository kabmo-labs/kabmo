/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Line arithmetic over a buffer: which line an offset is on, and where that
 * line begins.
 *
 * Two consumers, and they must agree — the highlighter's per-line walk and the
 * find widget's "jump to line N" both turn a line number into an offset. The
 * editor's own line COMMANDS no longer come through here: every one of them
 * (delete, move, duplicate, comment, indent) is a CodeMirror command now, and
 * `state.doc.line*` is what they read. `lineRangeAt`/`lineRangesInSelection`
 * went with them.
 */

/** Half-open `[start, end)` offset range in a document. */
export interface TextRange {
  start: number;
  end: number;
}

/** Index of the line containing `offset` (0-based). */
export function lineIndexAt(text: string, offset: number): number {
  const limit = Math.min(Math.max(offset, 0), text.length);
  let line = 0;
  for (let index = text.indexOf('\n'); index !== -1 && index < limit; index = text.indexOf('\n', index + 1)) {
    line++;
  }
  return line;
}

/** Offset of the first character of line `lineIndex` (0-based). */
export function lineStartOffset(text: string, lineIndex: number): number {
  let offset = 0;
  for (let i = 0; i < lineIndex; i++) {
    const next = text.indexOf('\n', offset);
    if (next === -1) return text.length;
    offset = next + 1;
  }
  return offset;
}
