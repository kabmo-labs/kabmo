/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The read-only table the CSV grid and the workbook viewer both draw.
 *
 * One component because a grid is a grid: two renderers would drift on the
 * things that actually matter here — the sticky header, the frozen row-number
 * gutter, the theme colours, and the truncation notice. The two callers differ
 * only in how they produced the cells (a text parse, a workbook read).
 *
 * `table-fixed` with a `<colgroup>` is deliberate, and it is the lesson the diff
 * panel's wrap toggle already paid for: an auto-layout table sizes a column by
 * its widest cell's unbreakable minimum, so one long cell widens the table past
 * the panel and the whole thing scrolls sideways. A fixed layout with a pinned
 * first column keeps the row number visible while the data scrolls, which is
 * what makes a wide sheet readable at all.
 *
 * Nothing here is editable. A grid cell that looked editable would promise a
 * write neither viewer can perform (no CSV writer, and `read-excel-file` does
 * not write workbooks), so the cells are plain text.
 */

import { useMemo } from 'preact/hooks';

/** A cell's display text. */
export type GridCell = string;

interface DataGridProps {
  /** Column labels; the first column of the grid is the row number. */
  header: GridCell[];
  rows: GridCell[][];
  /** The source held more rows or columns than were rendered. */
  truncated: boolean;
}

/** Width of the row-number gutter, and the reason it is not a percentage. */
const GUTTER_PX = 44;

export function DataGrid({ header, rows, truncated }: DataGridProps) {
  // A stable colgroup: fixed layout reads widths from it, and without one every
  // column would size from the first row's cells.
  const columns = useMemo(() => header.map((_, index) => index), [header]);

  if (header.length === 0 && rows.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center text-xs text-ink/50">
        This file has no rows.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {truncated && (
        <div className="shrink-0 border-b border-warning/30 bg-warning/10 px-3 py-1 font-sans text-[11px] text-warning">
          Showing the first {rows.length.toLocaleString()} rows.
        </div>
      )}
      <div className="flex-1 overflow-auto">
        <table className="w-full table-fixed border-collapse font-mono text-[11px]">
          <colgroup>
            <col style={{ width: `${GUTTER_PX}px` }} />
            {columns.map((index) => (
              <col key={index} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-canvas">
            <tr>
              <th className="border-b border-r border-ink/10 px-2 py-1 text-right font-normal text-ink/30">#</th>
              {header.map((cell, index) => (
                <th
                  key={index}
                  className="border-b border-ink/10 px-2 py-1 text-left font-semibold text-ink/80"
                  title={cell}
                >
                  <span className="block truncate">{cell}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="odd:bg-ink/[0.02]">
                <td className="border-b border-r border-ink/10 px-2 py-0.5 text-right tabular-nums text-ink/30">
                  {rowIndex + 1}
                </td>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="border-b border-ink/10 px-2 py-0.5 text-ink" title={cell}>
                    <span className="block truncate">{cell}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
