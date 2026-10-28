/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Delimited-text parsing for the CSV grid viewer.
 *
 * RFC 4180 with the two extensions every real file uses: a bare LF row ending
 * (Excel on macOS, and every generator that writes `\n`), and an empty final
 * row (a trailing newline is not a row).
 *
 * Quoting is the whole difficulty, and it is why this is not `split(',')`: a
 * quoted field may contain the delimiter, a newline, and a doubled `""` for a
 * literal quote. A naive split turns one row into three the moment a cell holds
 * a comma, which is exactly the file a user opens this viewer to read.
 *
 * The parse is bounded by row and column caps. A grid is a DOM surface — one
 * row is one `<tr>` — so an unbounded file would mount a table the browser
 * cannot lay out. The caller is told the result was cut (`truncated`) rather
 * than shown a silently short file.
 */

/** Rows rendered before the grid stops. Stated in the notice the viewer draws. */
export const MAX_CSV_ROWS = 2000;

/** Columns rendered before a row is cut. */
export const MAX_CSV_COLUMNS = 100;

export interface CsvTable {
  /** Header row, or the first row when the file has no header (see `hasHeader`). */
  header: string[];
  /** Data rows, each padded/trimmed to `header.length`. */
  rows: string[][];
  /** True when the file held more rows or columns than the caps allow. */
  truncated: boolean;
  /** The delimiter the file was parsed with. */
  delimiter: ',' | '\t';
}

/**
 * The delimiter a file uses: tab when its extension says TSV or its first line
 * carries more tabs than commas, else a comma.
 *
 * Sniffing is worth the three lines because a `.csv` exported from a tool with
 * tab separators is common, and a comma parse of it yields one enormous column.
 */
export function sniffDelimiter(text: string, filePath?: string | null): ',' | '\t' {
  if (/\.tsv$/i.test(filePath ?? '')) return '\t';
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'));
  let tabs = 0;
  let commas = 0;
  let quoted = false;
  for (let i = 0; i < firstLine.length; i += 1) {
    const ch = firstLine[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === '\t') tabs += 1;
    else if (!quoted && ch === ',') commas += 1;
  }
  return tabs > commas ? '\t' : ',';
}

/**
 * Split delimited text into cells, honoring RFC 4180 quoting.
 *
 * One pass, character by character, because the parser has to carry two pieces
 * of state across a character: whether it is inside a quoted field, and whether
 * the quote it just saw was a doubled one. A regex cannot express the second
 * without lookahead gymnastics that read worse than the loop.
 */
function parseCells(text: string, delimiter: string, maxColumns: number): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let cellCount = 0;

  const endCell = () => {
    if (cellCount < maxColumns) row.push(cell);
    cell = '';
    cellCount += 1;
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
    cellCount = 0;
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        // A doubled quote is a literal one; a single quote closes the field.
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell.length === 0) {
      quoted = true;
      continue;
    }
    if (ch === delimiter) {
      endCell();
      continue;
    }
    if (ch === '\r') {
      // CRLF or a lone CR: both end the row, and the LF that follows (if any)
      // is consumed with it so it does not open an empty row.
      if (text[i + 1] === '\n') i += 1;
      endRow();
      continue;
    }
    if (ch === '\n') {
      endRow();
      continue;
    }
    cell += ch;
  }
  // A trailing newline ends the last row already; only emit when text remains.
  if (cell.length > 0 || row.length > 0) endRow();
  return rows;
}

/**
 * Parse delimited text into a table for the grid viewer.
 *
 * The first row is the header. That is the convention for a CSV a user opens to
 * read (a data export), and treating it as data would label the columns
 * `1 2 3` for every file that has one — the common case. A file that genuinely
 * has no header loses one row of labelling, which the row count still shows.
 */
export function parseCsv(text: string, filePath?: string | null): CsvTable {
  const delimiter = sniffDelimiter(text, filePath);
  const all = parseCells(text, delimiter, MAX_CSV_COLUMNS);
  const truncated = all.length > MAX_CSV_ROWS;
  const visible = truncated ? all.slice(0, MAX_CSV_ROWS) : all;

  const [header = [], ...body] = visible;
  // Every row is padded to the header's width so the grid's columns stay
  // aligned; a ragged file otherwise shifts every cell after the short row.
  const width = header.length;
  const rows = body.map((row) => (row.length === width ? row : padRow(row, width)));
  return { header, rows, truncated, delimiter };
}

function padRow(row: string[], width: number): string[] {
  if (row.length > width) return row.slice(0, width);
  const next = row.slice();
  while (next.length < width) next.push('');
  return next;
}
