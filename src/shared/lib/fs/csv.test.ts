/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Writing a table back as delimited text.
 *
 * The failure this prevents is the parser's, in the other direction: a cell
 * holding a comma, a quote or a newline must not split the row it is written
 * into. The two normalizations (minimal quoting, no trailing empty fields) are
 * pinned because they are what a round trip through the grid actually does to
 * a file.
 */

import { describe, expect, test } from 'bun:test';
import { parseCsv, serializeCsv } from '@/shared/lib/fs/csv';

describe('serializeCsv', () => {
  test('a plain table is written with the delimiter and LF', () => {
    expect(serializeCsv(['Name', 'Qty'], [['Widget', '3']], ',')).toBe('Name,Qty\nWidget,3');
  });

  test('a tab-delimited table keeps its delimiter', () => {
    expect(serializeCsv(['a', 'b'], [['1', '2']], '\t')).toBe('a\tb\n1\t2');
  });

  test('a field holding the delimiter, a quote or a newline is quoted', () => {
    expect(serializeCsv(['a'], [['x,y'], ['say "hi"'], ['line\nbreak']], ',')).toBe(
      'a\n"x,y"\n"say ""hi"""\n"line\nbreak"',
    );
  });

  test('a trailing newline is preserved when the original had one', () => {
    expect(serializeCsv(['a'], [['1']], ',', true)).toBe('a\n1\n');
  });

  // `parseCsv` pads every row to the header's width so the grid's columns line
  // up; writing that padding back would add delimiters the file never had.
  test('trailing empty fields are dropped, and a row keeps one field', () => {
    expect(serializeCsv(['a', 'b', 'c'], [['1', '', '']], ',')).toBe('a,b,c\n1');
    expect(serializeCsv(['a'], [['']], ',')).toBe('a\n');
  });

  test('a round trip through the parser keeps the cells', () => {
    const text = 'Name,Qty\n"Widget, large",3\nGadget,1\n';
    const table = parseCsv(text, 'data.csv');
    expect(serializeCsv(table.header, table.rows, table.delimiter, true)).toBe(text);
  });
});
