/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The viewer dispatch and the CSV grid parser.
 *
 * Both are pure, and both have a decision that fails silently if wrong: a file
 * sent to the wrong viewer renders a refusal or a blank surface, and a CSV
 * parsed without quote handling splits one row into three the moment a cell
 * contains a comma — the exact file a user opens the grid to read.
 */

import { describe, expect, test } from 'bun:test';
import { BINARY_VIEWERS, RENDERED_VIEWERS, VIEWER_LABELS, viewerKindFor, type ViewerKind } from '@/shared/lib/fs/document-kind';
import { MAX_CSV_COLUMNS, MAX_CSV_ROWS, parseCsv, sniffDelimiter } from '@/shared/lib/fs/csv';

describe('viewerKindFor', () => {
  test('each family maps to its viewer', () => {
    expect(viewerKindFor('a.md')).toBe('markdown');
    expect(viewerKindFor('a.markdown')).toBe('markdown');
    expect(viewerKindFor('a.csv')).toBe('csv');
    expect(viewerKindFor('a.tsv')).toBe('csv');
    expect(viewerKindFor('a.png')).toBe('image');
    expect(viewerKindFor('a.pdf')).toBe('pdf');
    expect(viewerKindFor('a.docx')).toBe('docx');
    expect(viewerKindFor('a.xlsx')).toBe('spreadsheet');
    expect(viewerKindFor('a.xlsm')).toBe('spreadsheet');
  });

  // SVG is a picture to the eye while its bytes are editable XML text, and
  // `file-kind` deliberately keeps it on the TEXT path. The viewer must still
  // route it to the SVG surface, or the eye toggle has nothing to toggle.
  test('svg is its own viewer, not an image or code', () => {
    expect(viewerKindFor('logo.svg')).toBe('svg');
  });

  test('an unrecognised or missing extension is code', () => {
    expect(viewerKindFor('a.ts')).toBe('code');
    expect(viewerKindFor('Makefile')).toBe('code');
    expect(viewerKindFor('')).toBe('code');
    expect(viewerKindFor(undefined)).toBe('code');
  });

  // `.xls` is the legacy OLE2 binary the reader refuses outright. Routing it to
  // the sheet viewer would show a parse error; the honest answer is the code
  // path's "not text" refusal.
  test('legacy .xls is not claimed by the sheet viewer', () => {
    expect(viewerKindFor('legacy.xls')).toBe('code');
  });

  test('the uppercase extension is recognised', () => {
    expect(viewerKindFor('REPORT.PDF')).toBe('pdf');
    expect(viewerKindFor('Data.XLSX')).toBe('spreadsheet');
  });

  test('every kind has a row in both lookup tables', () => {
    const kinds: ViewerKind[] = ['code', 'markdown', 'svg', 'csv', 'image', 'pdf', 'docx', 'spreadsheet'];
    for (const kind of kinds) {
      expect(kind in BINARY_VIEWERS).toBe(true);
      expect(kind in RENDERED_VIEWERS).toBe(true);
      // The status strip's word has to exist for every kind too, or a byte
      // viewer's footer prints `undefined` where the viewer's name belongs.
      expect(VIEWER_LABELS[kind].length).toBeGreaterThan(0);
    }
    // The binary viewers are exactly the byte-fetching ones, so a new kind
    // cannot be added to one table and forgotten in the other.
    expect(BINARY_VIEWERS.pdf).toBe(true);
    expect(BINARY_VIEWERS.image).toBe(true);
    expect(BINARY_VIEWERS.csv).toBeUndefined();
    expect(RENDERED_VIEWERS.csv).toBe(true);
    expect(RENDERED_VIEWERS.pdf).toBeUndefined();
    // A byte viewer's label is its document kind, never the language badge the
    // empty buffer would otherwise produce.
    expect(VIEWER_LABELS.pdf).toBe('PDF');
    expect(VIEWER_LABELS.code).toBe('Text');
  });
});

describe('sniffDelimiter', () => {
  test('a .tsv extension wins outright', () => {
    expect(sniffDelimiter('a,b,c', 'x.tsv')).toBe('\t');
  });

  test('more tabs than commas on the first line means tab-delimited', () => {
    expect(sniffDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
  });

  test('a plain CSV is comma-delimited', () => {
    expect(sniffDelimiter('a,b,c\n1,2,3')).toBe(',');
  });

  // A quoted field may contain the OTHER delimiter, and counting it would flip
  // the guess: `"a,b",c,d` has two commas and one tab-like field but is a CSV.
  test('a delimiter inside a quoted field is not counted', () => {
    expect(sniffDelimiter('"a\tb",c,d')).toBe(',');
  });
});

describe('parseCsv', () => {
  test('the first row is the header and the rest are data', () => {
    const table = parseCsv('Name,Qty\nWidget,3\nGadget,1');
    expect(table.header).toEqual(['Name', 'Qty']);
    expect(table.rows).toEqual([
      ['Widget', '3'],
      ['Gadget', '1'],
    ]);
    expect(table.truncated).toBe(false);
  });

  // The failure this parser exists to prevent: a quoted cell holding the
  // delimiter must stay ONE cell, not split the row.
  test('a quoted field keeps its delimiter, newline and doubled quote', () => {
    const table = parseCsv('a,b\n"x,y","line1\nline2"\n"he said ""hi""",z');
    expect(table.rows[0]).toEqual(['x,y', 'line1\nline2']);
    expect(table.rows[1]).toEqual(['he said "hi"', 'z']);
  });

  test('a trailing newline does not create an empty row', () => {
    const table = parseCsv('a,b\n1,2\n');
    expect(table.rows).toEqual([['1', '2']]);
  });

  test('CRLF row endings are handled', () => {
    const table = parseCsv('a,b\r\n1,2\r\n3,4');
    expect(table.header).toEqual(['a', 'b']);
    expect(table.rows).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  // A ragged file would otherwise shift every cell after the short row, which
  // is what makes a grid unreadable.
  test('a short row is padded to the header width', () => {
    const table = parseCsv('a,b,c\n1,2\n3,4,5');
    expect(table.rows[0]).toEqual(['1', '2', '']);
    expect(table.rows[1]).toEqual(['3', '4', '5']);
  });

  test('a long row is trimmed to the header width', () => {
    const table = parseCsv('a,b\n1,2,3,4');
    expect(table.rows[0]).toEqual(['1', '2']);
  });

  test('a tab file is parsed with tabs, whatever the extension', () => {
    const table = parseCsv('a\tb\n1\t2', 'data.tsv');
    expect(table.header).toEqual(['a', 'b']);
    expect(table.rows).toEqual([['1', '2']]);
  });

  test('a file with only a header has no rows', () => {
    const table = parseCsv('a,b,c');
    expect(table.header).toEqual(['a', 'b', 'c']);
    expect(table.rows).toEqual([]);
  });

  test('an empty file yields an empty table', () => {
    const table = parseCsv('');
    expect(table.header).toEqual([]);
    expect(table.rows).toEqual([]);
  });

  // The caps are what keep a grid from mounting a table the browser cannot lay
  // out; crossing either must be REPORTED, not silently short.
  test('a file past the row cap is truncated and says so', () => {
    const lines = ['h'];
    for (let i = 0; i < MAX_CSV_ROWS + 10; i += 1) lines.push(String(i));
    const table = parseCsv(lines.join('\n'));
    expect(table.truncated).toBe(true);
    expect(table.rows.length).toBe(MAX_CSV_ROWS - 1);
  });

  test('a row past the column cap is cut, and the header too', () => {
    const wide = Array.from({ length: MAX_CSV_COLUMNS + 5 }, (_, i) => `c${i}`).join(',');
    const table = parseCsv(`${wide}\n${wide}`);
    expect(table.header.length).toBe(MAX_CSV_COLUMNS);
    expect(table.rows[0].length).toBe(MAX_CSV_COLUMNS);
  });

  test('a file exactly at the row cap is not truncated', () => {
    const lines = ['h'];
    for (let i = 0; i < MAX_CSV_ROWS - 1; i += 1) lines.push(String(i));
    const table = parseCsv(lines.join('\n'));
    expect(table.truncated).toBe(false);
    expect(table.rows.length).toBe(MAX_CSV_ROWS - 1);
  });
});
