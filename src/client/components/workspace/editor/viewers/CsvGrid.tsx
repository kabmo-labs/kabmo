/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A CSV/TSV file drawn as a grid.
 *
 * The one viewer here that takes TEXT rather than bytes, because a CSV already
 * is text: it arrives through the same read the code surface uses, so the grid
 * and the source are two views of one buffer and the eye toggle switches
 * between them without a second fetch. That is also why the grid is a pure
 * function of its `content` — a keystroke in the source updates it live, which
 * is the honest behaviour for a file that IS its own text.
 *
 * **An edit is a text edit.** A committed cell is written back into the table
 * and the table is serialized to delimited text, which goes through the tab's
 * ordinary `onChange` — so the dirty dot, the autosave, the conflict guard and
 * the toolbar's Save are the same ones every text file has. There is no second
 * save path for CSV.
 *
 * Editing is refused when the parse was CAPPED: the grid holds the first
 * `MAX_CSV_ROWS` rows, and writing that table back would drop every row past
 * the cap. The strip says so instead of silently truncating the file.
 *
 * Parsing and serialization live in `shared/lib/fs/csv.ts` (pure, unit-tested):
 * quote handling is the whole difficulty, and it must not be re-implemented per
 * surface.
 */

import { useMemo } from 'preact/hooks';
import { parseCsv, serializeCsv } from '@/shared/lib/fs/csv';
import { replaceCell } from '@/shared/lib/fs/grid-edit';
import { DataGrid } from '@/client/components/workspace/editor/viewers/DataGrid';

interface CsvGridProps {
  content: string;
  /** Used only to pick the delimiter when the extension says TSV. */
  path: string;
  /** Write the edited text back into the tab's buffer; absent means read-only. */
  onChange?: (next: string) => void;
}

export function CsvGrid({ content, path, onChange }: CsvGridProps) {
  const table = useMemo(() => parseCsv(content, path), [content, path]);
  const editable = onChange !== undefined && !table.truncated;
  const trailingNewline = content.endsWith('\n');

  const editCell = editable
    ? (row: number, col: number, value: string) => {
        onChange(serializeCsv(table.header, replaceCell(table.rows, row, col, value), table.delimiter, trailingNewline));
      }
    : undefined;

  const editHeader = editable
    ? (col: number, value: string) => {
        const header = table.header.slice();
        while (header.length <= col) header.push('');
        header[col] = value;
        onChange(serializeCsv(header, table.rows, table.delimiter, trailingNewline));
      }
    : undefined;

  return (
    <DataGrid
      header={table.header}
      rows={table.rows}
      truncated={table.truncated}
      readOnlyNote={
        table.truncated
          ? 'This file is too large to edit in the grid — use Show source.'
          : editable
            ? 'Paste is not supported — double-click a cell to edit it.'
            : 'This grid is read-only — use Show source to edit the cells.'
      }
      onEditCell={editCell}
      onEditHeader={editHeader}
    />
  );
}
