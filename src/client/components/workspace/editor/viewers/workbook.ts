/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Reading a workbook into the grid's shape, and writing an edited one back.
 *
 * SheetJS (`xlsx`) rather than `read-excel-file`, which this viewer used before
 * `.xls` was supported. The legacy format is an OLE2 compound file holding BIFF
 * records, and `read-excel-file` reads only the ZIP-based OOXML formats — so
 * supporting `.xls` at all means a BIFF reader, and SheetJS is the maintained
 * one. The package is installed from SheetJS's own distribution
 * (`cdn.sheetjs.com`, 0.20.3) because the copy on npm is a stale 0.18.5 with
 * published advisories. Measured cost: 376 KB minified in the client bundle
 * (`bun build --minify`), against 55 KB for the reader it replaces — a 2.7%
 * increase on a 13.8 MB bundle that the local server hands over, and the price
 * of opening `.xls` at all.
 *
 * `raw: false` is what makes a cell read like the spreadsheet shows it: the
 * reader returns the cell's FORMATTED text (`w`), so a date is the file's own
 * date format and a currency keeps its symbol, instead of a serial number the
 * grid would have to re-format. A formula's cached value is what comes back,
 * which is what Excel shows too.
 *
 * **The reader's own workbook is kept**, not just the display rows. An edit
 * writes ONE cell into that workbook and the save serializes it, so every sheet
 * and every cell the user did not touch keeps its value, formula and number
 * format. Rebuilding a workbook from the display rows would silently drop all
 * of it.
 *
 * The read is bounded by the same row and column caps as the CSV grid: a grid
 * is a DOM surface, and an unbounded sheet would mount a table the browser
 * cannot lay out. The caller is told the result was cut (`truncated`) rather
 * than shown a silently short sheet. The CAP is display-only — the workbook
 * behind it is whole, so saving an edit never drops the rows past the cap.
 */

import * as XLSX from 'xlsx';
import { MAX_CSV_COLUMNS, MAX_CSV_ROWS } from '@/shared/lib/fs/csv';

/** One sheet as the grid draws it: a name and its rows of display text. */
export interface WorkbookSheet {
  name: string;
  rows: string[][];
  /** The sheet held more rows or columns than the caps allow. */
  truncated: boolean;
}

/** The container a workbook was read from, and the one it is written back as. */
export type WorkbookFormat = 'xlsx' | 'xlsm' | 'xls';

export interface LoadedWorkbook {
  /** The reader's workbook, kept so an edit can be written back losslessly. */
  book: XLSX.WorkBook;
  sheets: WorkbookSheet[];
  format: WorkbookFormat;
}

/** The container a path names. Anything else is treated as the modern format. */
export function workbookFormatFor(path: string): WorkbookFormat {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (extension === 'xls') return 'xls';
  if (extension === 'xlsm') return 'xlsm';
  return 'xlsx';
}

export async function readWorkbook(bytes: ArrayBuffer, path: string): Promise<LoadedWorkbook> {
  const book = XLSX.read(new Uint8Array(bytes), { type: 'array', cellDates: true, bookVBA: true });

  const sheets = book.SheetNames.map((name) => {
    const sheet = book.Sheets[name];
    const ref = sheet?.['!ref'];
    if (!sheet || !ref) return { name, rows: [], truncated: false };

    const bounds = XLSX.utils.decode_range(ref);
    const lastRow = Math.min(bounds.e.r, MAX_CSV_ROWS);
    const lastCol = Math.min(bounds.e.c, MAX_CSV_COLUMNS - 1);
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      raw: false,
      defval: '',
      blankrows: true,
      range: { s: { r: 0, c: 0 }, e: { r: lastRow, c: lastCol } },
    });

    return {
      name,
      rows: rows.map((row) => row.map((cell) => (cell == null ? '' : String(cell)))),
      truncated: bounds.e.r > MAX_CSV_ROWS || bounds.e.c >= MAX_CSV_COLUMNS,
    };
  });

  return { book, sheets, format: workbookFormatFor(path) };
}

/**
 * Write one cell into the reader's workbook.
 *
 * `row` and `col` are ABSOLUTE sheet coordinates (0-based), not the grid's data
 * rows: the grid's first data row is the sheet's row 1, because row 0 is drawn
 * as the header strip.
 *
 * A numeric-looking value becomes a number, which is what typing `3` into a
 * spreadsheet does; everything else is text. The cell's style and number format
 * are kept, and its formula is dropped — the user replaced the formula's result
 * with a literal, and keeping `f` would make Excel recompute over the new value.
 */
export function setWorkbookCell(
  book: XLSX.WorkBook,
  sheetName: string,
  row: number,
  col: number,
  value: string,
): void {
  const sheet = book.Sheets[sheetName];
  if (!sheet) return;
  const address = XLSX.utils.encode_cell({ r: row, c: col });
  const previous = sheet[address] as XLSX.CellObject | undefined;
  const numeric = value !== '' && /^-?\d+(\.\d+)?$/.test(value);
  const cell: XLSX.CellObject = numeric
    ? { t: 'n', v: Number(value) }
    : { t: 's', v: value };
  if (previous?.s) cell.s = previous.s;
  if (previous?.z) cell.z = previous.z;
  sheet[address] = cell;

  // A cell written past the sheet's recorded range would be dropped by the
  // writer, so the range grows with the edit.
  const ref = sheet['!ref'];
  if (ref) {
    const bounds = XLSX.utils.decode_range(ref);
    bounds.e.r = Math.max(bounds.e.r, row);
    bounds.e.c = Math.max(bounds.e.c, col);
    sheet['!ref'] = XLSX.utils.encode_range(bounds);
  }
}

/** Serialize the edited workbook back into its own container. */
export function writeWorkbook(book: XLSX.WorkBook, format: WorkbookFormat): Uint8Array {
  const bytes = XLSX.write(book, {
    type: 'array',
    bookType: format,
    cellDates: true,
    compression: true,
    bookVBA: format === 'xlsm',
  }) as ArrayBuffer;
  return new Uint8Array(bytes);
}
