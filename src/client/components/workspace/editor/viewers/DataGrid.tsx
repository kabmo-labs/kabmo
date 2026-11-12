/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The table the CSV grid and the workbook viewer both draw.
 *
 * One component because a grid is a grid: two renderers would drift on the
 * things that actually matter here — the sticky header, the frozen row-number
 * gutter, the theme colours, the truncation notice, the selection and the
 * clipboard. The two callers differ only in how they produced the cells (a
 * text parse, a workbook read) and in what an edit means to them.
 *
 * `table-fixed` with a `<colgroup>` is deliberate, and it is the lesson the diff
 * panel's wrap toggle already paid for: an auto-layout table sizes a column by
 * its widest cell's unbreakable minimum, so one long cell widens the table past
 * the panel and the whole thing scrolls sideways. A fixed layout with a pinned
 * first column keeps the row number visible while the data scrolls, which is
 * what makes a wide sheet readable at all.
 *
 * **Editing is opt-in.** A caller that passes `onEditCell` gets a spreadsheet:
 * double-click (or Enter, or typing) opens an input inside the cell, Enter and
 * Tab commit and move, Escape cancels, and a click elsewhere commits. A caller
 * that passes nothing gets the read-only grid it always had — which is what the
 * CSV viewer does when its file is truncated, because writing a capped table
 * back would drop every row past the cap.
 *
 * The event handlers live in `use-grid-interaction.ts`; this file is the
 * selection state, the effects and the markup.
 */

import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { copyToClipboard } from '@/client/hooks/ui/clipboard';
import { useGridSelection } from '@/client/hooks/editor/use-grid-selection';
import { useCellEdit, type CellEdit, type CellSection } from '@/client/components/workspace/editor/viewers/use-cell-edit';
import { useGridInteraction } from '@/client/components/workspace/editor/viewers/use-grid-interaction';
import { GridRow } from '@/client/components/workspace/editor/viewers/GridRow';
import { GridToolbar, type CopyState } from '@/client/components/workspace/editor/viewers/GridToolbar';
import {
  columnLabel,
  rangeAddress,
  rangeColumnCount,
  rangeRowCount,
  rangeToTsv,
} from '@/shared/lib/fs/grid-selection';

interface DataGridProps {
  /** Column labels; the first column of the grid is the row number. */
  header: string[];
  rows: string[][];
  /** The source held more rows or columns than were rendered. */
  truncated: boolean;
  /** What the grid is, for the status strip and the accessible name. */
  label?: string;
  /** What a paste is refused with — the grid never writes, so it must say why. */
  readOnlyNote?: string;
  /** Edit a data cell; absent means the grid is read-only. */
  onEditCell?: (row: number, col: number, value: string) => void;
  /** Edit a header cell; absent means the header is a label. */
  onEditHeader?: (col: number, value: string) => void;
  /** Caller-owned controls in the strip (a workbook's Save). */
  actions?: ComponentChildren;
}

/** Width of the row-number gutter, and the reason it is not a percentage. */
const GUTTER_PX = 44;

/** How long the copy confirmation stays up. */
const COPY_FEEDBACK_MS = 1600;

export function DataGrid({
  header,
  rows,
  truncated,
  label,
  readOnlyNote,
  onEditCell,
  onEditHeader,
  actions,
}: DataGridProps) {
  // A stable colgroup: fixed layout reads widths from it, and without one every
  // column would size from the first row's cells.
  const width = useMemo(
    () => rows.reduce((widest, row) => Math.max(widest, row.length), header.length),
    [header, rows],
  );
  const labels = useMemo(
    () => Array.from({ length: width }, (_, index) => header[index] ?? columnLabel(index)),
    [header, width],
  );
  // Ragged rows are padded once, so a short row cannot shift the cells after it
  // and the selection arithmetic has one width to work with.
  const cells = useMemo(
    () => rows.map((row) => (row.length === width ? row : Array.from({ length: width }, (_, index) => row[index] ?? ''))),
    [rows, width],
  );

  const selection = useGridSelection(cells.length, width);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [copyState, setCopyState] = useState<CopyState>('idle');

  const commitEdit = useCallback(
    (edit: CellEdit) => {
      if (edit.section === 'header') onEditHeader?.(edit.col, edit.value);
      else onEditCell?.(edit.row, edit.col, edit.value);
    },
    [onEditCell, onEditHeader],
  );
  const editor = useCellEdit(commitEdit);
  const edit = editor.edit;

  const startEdit = useCallback(
    (section: CellSection, row: number, col: number, initial?: string) => {
      if (section === 'header' ? !onEditHeader : !onEditCell) return;
      const current = section === 'header' ? (labels[col] ?? '') : (cells[row]?.[col] ?? '');
      editor.begin(section, row, col, initial ?? current);
    },
    [cells, editor, labels, onEditCell, onEditHeader],
  );

  const copy = useCallback(async () => {
    if (!selection.range) return;
    const ok = await copyToClipboard(rangeToTsv(cells, selection.range));
    setCopyState(ok ? 'copied' : 'failed');
  }, [cells, selection.range]);

  useEffect(() => {
    if (copyState === 'idle') return;
    const timer = setTimeout(() => setCopyState('idle'), COPY_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copyState]);

  // A drag that leaves the table still ends: the pointerup lands on whatever is
  // under it, which is not necessarily a cell.
  const { dragging, endDrag } = selection;
  useEffect(() => {
    if (!dragging) return;
    const end = () => endDrag();
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [dragging, endDrag]);

  // Keyboard navigation must bring the active cell into view, or an arrow key
  // past the fold moves a selection the user cannot see.
  const active = selection.active;
  useEffect(() => {
    if (!active) return;
    const cell = scrollerRef.current?.querySelector(`[data-row="${active.row}"][data-col="${active.col}"]`);
    (cell as HTMLElement | null)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [active]);

  // Focus the input when a cell opens, and only then: keying this on the whole
  // edit object would re-select the text on every keystroke.
  const editKey = edit ? `${edit.section}:${edit.row}:${edit.col}` : '';
  useEffect(() => {
    if (!editKey) return;
    const input = scrollerRef.current?.querySelector('[data-edit-input]') as HTMLInputElement | null;
    input?.focus();
    input?.select();
  }, [editKey]);

  const interaction = useGridInteraction({
    cells,
    width,
    selection,
    editor,
    scrollerRef,
    startEdit,
    onEditCell,
    setCopyState,
  });

  if (width === 0 && cells.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center text-xs text-ink/50">
        This file has no rows.
      </div>
    );
  }

  const range = selection.range;
  const status =
    copyState === 'refused'
      ? (readOnlyNote ?? 'This grid is read-only.')
      : range
        ? `${rangeAddress(range)} · ${rangeRowCount(range)}×${rangeColumnCount(range)}`
        : 'Click a cell, drag to select a block';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {truncated && (
        <div className="shrink-0 border-b border-warning/30 bg-warning/10 px-3 py-1 font-sans text-[11px] text-warning">
          Showing the first {cells.length.toLocaleString()} rows.
        </div>
      )}
      <GridToolbar
        status={status}
        tone={copyState === 'refused' ? 'warning' : 'muted'}
        actions={actions}
        canCopy={range !== null}
        copyState={copyState}
        onCopy={() => void copy()}
      />
      <div
        ref={scrollerRef}
        tabIndex={0}
        role="grid"
        aria-label={label ?? 'Spreadsheet'}
        className="flex-1 overflow-auto outline-none"
        onPointerDown={interaction.onPointerDown}
        onPointerOver={interaction.onPointerOver}
        onDblClick={interaction.onDoubleClick}
        onInput={interaction.onInput}
        onKeyDown={interaction.onKeyDown}
        onCopy={interaction.onCopy}
        onPaste={interaction.onPaste}
      >
        <table className="w-full table-fixed select-none border-collapse font-mono text-[11px]">
          <colgroup>
            <col style={{ width: `${GUTTER_PX}px` }} />
            {labels.map((_, index) => (
              <col key={index} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-canvas">
            <tr>
              <th
                data-corner
                title="Select all"
                className="cursor-pointer border-b border-r border-ink/10 px-2 py-1 text-right font-normal text-ink/30"
              >
                #
              </th>
              {labels.map((cell, index) => {
                const inRange = range !== null && index >= range.left && index <= range.right;
                const isEditing = edit?.section === 'header' && edit.col === index;
                return (
                  <th
                    key={index}
                    data-col-header={index}
                    title={cell}
                    className={`cursor-pointer border-b border-ink/10 px-2 py-1 text-left font-semibold ${
                      inRange ? 'bg-info/10 text-ink' : 'text-ink/80'
                    }`}
                  >
                    {isEditing ? (
                      <input
                        data-edit-input="true"
                        value={edit.value}
                        spellcheck={false}
                        className="w-full min-w-0 bg-transparent font-mono text-[11px] font-semibold text-ink outline-none"
                      />
                    ) : (
                      <span className="block truncate">{cell}</span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {cells.map((row, rowIndex) => {
              const inRange = range !== null && rowIndex >= range.top && rowIndex <= range.bottom;
              return (
                <GridRow
                  key={rowIndex}
                  cells={row}
                  rowIndex={rowIndex}
                  selectedLeft={inRange ? range.left : -1}
                  selectedRight={inRange ? range.right : -1}
                  activeCol={active?.row === rowIndex ? active.col : -1}
                  editingCol={edit?.section === 'data' && edit.row === rowIndex ? edit.col : -1}
                  editingValue={edit?.section === 'data' && edit.row === rowIndex ? edit.value : ''}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
