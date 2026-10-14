/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A workbook (`.xlsx` / `.xlsm`), drawn as a grid with one tab per sheet.
 *
 * `read-excel-file` rather than SheetJS: it is 55 KB minified for the browser
 * entry (SheetJS is 332 KB, and its `xlsx` package on npm is a stale 0.18.5
 * with a published advisory), it reads straight from an `ArrayBuffer`, and its
 * per-sheet API is exactly the shape a tabbed viewer needs. The whole library
 * is reached through the sheet's own static import, so a session that never
 * opens a workbook never downloads it.
 *
 * Values arrive already typed (numbers as numbers, dates as `Date`), so they are
 * formatted here rather than parsed: a cell is rendered as the string a
 * spreadsheet shows — `true`/`false` for booleans, an ISO date, a number in
 * locale form. A formula's cached value is what the reader returns, which is
 * what the user sees in Excel too.
 *
 * Read-only: the library reads workbooks, it does not write them, so there is
 * no Save and the toolbar hides the write controls for this kind.
 */

import { Loader2 } from 'lucide-preact';
import { useState } from 'preact/hooks';
import readXlsxFile from 'read-excel-file/browser';
import type { ByteSource } from '@/client/components/workspace/editor/viewers/bytes';
import { useByteDocument } from '@/client/components/workspace/editor/viewers/use-byte-document';
import { ViewerError } from '@/client/components/workspace/editor/viewers/ViewerError';
import { MAX_CSV_COLUMNS, MAX_CSV_ROWS } from '@/shared/lib/fs/csv';
import { DataGrid, type GridCell } from '@/client/components/workspace/editor/viewers/DataGrid';

interface SheetViewProps {
  source: ByteSource;
  name: string;
  revision?: number;
}

/** A sheet as the grid draws it: a header row and typed data rows. */
interface WorkbookSheet {
  name: string;
  rows: GridCell[][];
}

/** The string a spreadsheet cell shows, from the typed value the reader returns. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

async function readWorkbook(bytes: ArrayBuffer): Promise<WorkbookSheet[]> {
  const sheets = await readXlsxFile(bytes);
  return sheets.map((sheet) => ({
    name: sheet.sheet,
    rows: sheet.data
      .slice(0, MAX_CSV_ROWS + 1)
      .map((row) => row.slice(0, MAX_CSV_COLUMNS).map(cellText)),
  }));
}

export function SheetView({ source, name, revision = 0 }: SheetViewProps) {
  const { value, loading, error } = useByteDocument(source, readWorkbook, revision);
  const [active, setActive] = useState(0);

  if (error) return <ViewerError name={name} message={error} />;
  if (loading || value === null) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-xs text-ink/40">
        <Loader2 size={14} className="animate-spin" />
        <span>Loading workbook…</span>
      </div>
    );
  }

  const sheet = value[Math.min(active, value.length - 1)];
  if (!sheet) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center text-xs text-ink/50">
        This workbook has no sheets.
      </div>
    );
  }

  const [header = [], ...rows] = sheet.rows;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Sheet tabs: a workbook's own navigation. One row, scrolled sideways on
          a narrow panel rather than wrapped — a tab strip is a single line by
          definition, and wrapping it would shift the grid down per sheet count. */}
      {value.length > 1 && (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-ink/10 bg-canvas px-2 py-1 no-scrollbar">
          {value.map((entry, index) => (
            <button
              key={entry.name}
              type="button"
              onClick={() => setActive(index)}
              className={`shrink-0 rounded px-2 py-0.5 font-sans text-[11px] transition-colors ${
                index === active ? 'bg-ink/10 text-ink' : 'text-ink/50 hover:bg-ink/5 hover:text-ink'
              }`}
              aria-pressed={index === active}
            >
              {entry.name}
            </button>
          ))}
        </div>
      )}
      <DataGrid header={header} rows={rows} truncated={sheet.rows.length > MAX_CSV_ROWS} />
    </div>
  );
}
