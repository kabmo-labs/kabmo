/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The indent guide's decisions, as a pure function.
 *
 * The plugin (`indent-guide.ts`) is a view layer; what a guide MEANS is decided here,
 * so it can be tested without a mounted editor. Three rules, and each is a case the
 * naive version gets wrong:
 *
 * - a line indented at least one level gets exactly ONE guide (at the first level),
 *   not one per column;
 * - a blank line's whitespace is trailing noise, not structure, so it gets none;
 * - a line past `MAX_GUIDE_COLUMNS` gets none, because a minified file is one huge
 *   line and counting its indentation per frame is work nobody can see.
 */

/** Columns past which a line gets no guide. */
export const MAX_GUIDE_COLUMNS = 200;

/** The first level's column, in `ch`, or null when this line gets no guide. */
export function guideColumn(text: string, unit: number): number | null {
  if (unit <= 0) return null;
  // A blank line is a gap between blocks; its own indentation says nothing.
  if (!text.trim()) return null;
  const indent = /^[ \t]*/.exec(text)?.[0].length ?? 0;
  if (indent < unit) return null;
  if (indent > MAX_GUIDE_COLUMNS) return null;
  return unit;
}

/**
 * The guides for a run of lines, as `[lineIndex, column]` pairs.
 *
 * `lineIndex` is 0-based within `texts`, which is what a caller mapping back to
 * document positions already has.
 */
export function guideColumns(texts: readonly string[], unit: number): Array<{ index: number; column: number }> {
  const guides: Array<{ index: number; column: number }> = [];
  texts.forEach((text, index) => {
    const column = guideColumn(text, unit);
    if (column !== null) guides.push({ index, column });
  });
  return guides;
}
