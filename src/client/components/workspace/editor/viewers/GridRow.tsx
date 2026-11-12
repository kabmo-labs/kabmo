/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One data row of the spreadsheet grid, memoised.
 *
 * The memo is the reason this is a component at all: a 2000-row sheet is
 * 200 000 cells, and a selection change touches only the rows inside the old
 * and new rectangles. Without the memo every pointer move re-rendered the whole
 * table, which is what made dragging a selection feel like the panel had hung.
 * The props are deliberately primitives plus the row's own array, so the
 * shallow compare is exact.
 *
 * Pointer events are NOT handled here: the grid delegates them from one
 * listener and reads `data-row`/`data-col` off the target, so no cell mounts a
 * closure.
 */

import { memo } from 'preact/compat';

export interface GridRowProps {
  cells: readonly string[];
  rowIndex: number;
  /** First selected column in this row, or -1 when the row is outside the range. */
  selectedLeft: number;
  /** Last selected column in this row, or -1. */
  selectedRight: number;
  /** The active cell's column when it is in this row, else -1. */
  activeCol: number;
  /** The column being edited in this row, else -1. */
  editingCol: number;
  /** The draft text of the cell being edited. */
  editingValue: string;
}

export const GridRow = memo(function GridRow({
  cells,
  rowIndex,
  selectedLeft,
  selectedRight,
  activeCol,
  editingCol,
  editingValue,
}: GridRowProps) {
  const rowSelected = selectedLeft >= 0;
  return (
    <tr className="odd:bg-ink/[0.02]">
      <th
        data-row-header={rowIndex}
        className={`cursor-pointer border-b border-r border-ink/10 px-2 py-0.5 text-right font-normal tabular-nums ${
          rowSelected ? 'bg-info/10 text-ink/60' : 'text-ink/30'
        }`}
        title={`Select row ${rowIndex + 1}`}
      >
        {rowIndex + 1}
      </th>
      {cells.map((cell, col) => {
        const inRange = rowSelected && col >= selectedLeft && col <= selectedRight;
        const isActive = col === activeCol;
        const isEditing = col === editingCol;
        return (
          <td
            key={col}
            data-row={rowIndex}
            data-col={col}
            title={cell}
            className={`cursor-cell border-b border-ink/10 px-2 py-0.5 text-ink ${
              inRange ? 'bg-info/10' : ''
            } ${isActive ? 'ring-1 ring-inset ring-info' : ''}`}
          >
            {isEditing ? (
              // The editor is an input INSIDE the cell, so the grid keeps its
              // geometry while a value is typed. `data-edit-input` is how the
              // grid's delegated handlers find it.
              <input
                data-edit-input="true"
                value={editingValue}
                spellcheck={false}
                className="w-full min-w-0 bg-transparent font-mono text-[11px] text-ink outline-none"
              />
            ) : (
              <span className="block truncate">{cell}</span>
            )}
          </td>
        );
      })}
    </tr>
  );
});
