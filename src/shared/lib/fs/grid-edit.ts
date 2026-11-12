/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One cell's new value, in a grid that is drawn from an immutable table.
 *
 * The grid's rows are a value, not a mutable model: the CSV viewer re-parses
 * its text on every keystroke and the workbook viewer keeps the reader's own
 * workbook beside the display rows, so an edit has to produce a NEW table
 * rather than poke at the one on screen. A row that is shorter than the edited
 * column is padded, which is what makes editing a cell past a ragged row's end
 * work instead of writing to an index that does not exist.
 */
export function replaceCell(
  rows: readonly (readonly string[])[],
  row: number,
  col: number,
  value: string,
): string[][] {
  return rows.map((cells, index) => {
    if (index !== row) return cells as string[];
    const next = cells.slice();
    while (next.length <= col) next.push('');
    next[col] = value;
    return next;
  });
}
