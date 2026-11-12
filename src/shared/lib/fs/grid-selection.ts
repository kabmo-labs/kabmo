/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Cell geometry and clipboard text for the spreadsheet grid.
 *
 * The grid is a rectangle of cells, and every interaction on it — a click, a
 * drag, an arrow key, a copy — is the same two facts: which cell is the anchor
 * and which is the focus. Keeping that arithmetic here (pure, unit-tested)
 * means the component only draws, and the two things that fail silently when
 * wrong are pinned: a range that is off by one cell, and a clipboard payload
 * that Excel reads as one column because a cell held a tab.
 *
 * Addresses are A1-style over the DATA rows: the grid's first data row is row
 * 1, so `A1` is the top-left cell the user can select. The header strip is a
 * label, not a row, and is deliberately not addressable.
 */

/** A cell in the grid: zero-based row and column. */
export interface GridCell {
  row: number;
  col: number;
}

/** A rectangle of cells, inclusive on every edge. */
export interface GridRange {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** The rectangle spanned by two cells, in either order. */
export function cellRange(a: GridCell, b: GridCell): GridRange {
  return {
    top: Math.min(a.row, b.row),
    left: Math.min(a.col, b.col),
    bottom: Math.max(a.row, b.row),
    right: Math.max(a.col, b.col),
  };
}

/** Whether a cell falls inside a range. */
export function rangeContains(range: GridRange, row: number, col: number): boolean {
  return row >= range.top && row <= range.bottom && col >= range.left && col <= range.right;
}

/** How many rows a range covers. */
export function rangeRowCount(range: GridRange): number {
  return range.bottom - range.top + 1;
}

/** How many columns a range covers. */
export function rangeColumnCount(range: GridRange): number {
  return range.right - range.left + 1;
}

/**
 * The spreadsheet letter for a zero-based column: 0 → `A`, 25 → `Z`, 26 → `AA`.
 *
 * Bijective base-26, not plain base-26: there is no zero digit, so the
 * subtraction happens before the modulo and the quotient is floored after it.
 */
export function columnLabel(index: number): string {
  let remaining = index + 1;
  let label = '';
  while (remaining > 0) {
    const digit = (remaining - 1) % 26;
    label = String.fromCharCode(65 + digit) + label;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return label;
}

/** The A1 address of a cell. */
export function cellAddress(cell: GridCell): string {
  return `${columnLabel(cell.col)}${cell.row + 1}`;
}

/** The A1 address of a range: `B2` for one cell, `B2:D5` for a block. */
export function rangeAddress(range: GridRange): string {
  const start = cellAddress({ row: range.top, col: range.left });
  const end = cellAddress({ row: range.bottom, col: range.right });
  return start === end ? start : `${start}:${end}`;
}

/** A cell clamped into a grid of `rowCount` × `columnCount` cells. */
export function clampCell(cell: GridCell, rowCount: number, columnCount: number): GridCell {
  return {
    row: Math.min(Math.max(cell.row, 0), Math.max(rowCount - 1, 0)),
    col: Math.min(Math.max(cell.col, 0), Math.max(columnCount - 1, 0)),
  };
}

/** A cell moved by a delta and clamped to the grid. */
export function moveCell(
  cell: GridCell,
  rowDelta: number,
  columnDelta: number,
  rowCount: number,
  columnCount: number,
): GridCell {
  return clampCell({ row: cell.row + rowDelta, col: cell.col + columnDelta }, rowCount, columnCount);
}

/** The whole grid as a range, or null when it has no cells. */
export function selectAllRange(rowCount: number, columnCount: number): GridRange | null {
  if (rowCount <= 0 || columnCount <= 0) return null;
  return { top: 0, left: 0, bottom: rowCount - 1, right: columnCount - 1 };
}

/**
 * The selected block as tab-separated text, ready for Excel, Numbers or Sheets.
 *
 * Excel's own clipboard format is TSV, and a field that contains a tab, a line
 * break or a quote is wrapped in quotes with its quotes doubled — the same
 * convention as CSV. Without that a cell holding a newline splits one row into
 * two when pasted back into a spreadsheet, which is the exact round trip this
 * copy exists for.
 *
 * Rows are joined with CRLF because that is what Excel writes to the clipboard
 * on every platform; a bare LF is accepted by most consumers but not all.
 * Missing cells (a ragged row) are empty fields, so the block keeps its shape.
 */
export function rangeToTsv(rows: readonly (readonly string[])[], range: GridRange): string {
  const lines: string[] = [];
  for (let row = range.top; row <= range.bottom; row += 1) {
    const cells: string[] = [];
    for (let col = range.left; col <= range.right; col += 1) {
      const value = rows[row]?.[col] ?? '';
      cells.push(/[\t\r\n"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
    }
    lines.push(cells.join('\t'));
  }
  return lines.join('\r\n');
}
