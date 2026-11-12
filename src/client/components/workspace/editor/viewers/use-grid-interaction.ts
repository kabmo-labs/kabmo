/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The grid's delegated event handlers: pointer, keyboard, clipboard and the
 * inline editor's input.
 *
 * One listener per event on the scroller, not one per cell: a 2000-row sheet is
 * 200 000 cells, and a closure per cell is what makes such a grid unresponsive.
 * The handler reads `data-row`/`data-col` off the event target instead.
 *
 * Split from `DataGrid` for the repository's line ceiling, and because the
 * handlers are a self-contained cluster: they translate DOM events into
 * selection and edit operations and own no rendering.
 */

import type { RefObject } from 'preact';
import type { GridSelection } from '@/client/hooks/editor/use-grid-selection';
import type { CellEditor, CellSection } from '@/client/components/workspace/editor/viewers/use-cell-edit';
import type { CopyState } from '@/client/components/workspace/editor/viewers/GridToolbar';
import { rangeToTsv, type GridCell } from '@/shared/lib/fs/grid-selection';

interface GridInteractionOptions {
  cells: string[][];
  width: number;
  selection: GridSelection;
  editor: CellEditor;
  scrollerRef: RefObject<HTMLDivElement>;
  startEdit: (section: CellSection, row: number, col: number, initial?: string) => void;
  onEditCell?: (row: number, col: number, value: string) => void;
  setCopyState: (state: CopyState) => void;
}

export interface GridInteraction {
  onPointerDown: (event: PointerEvent) => void;
  onPointerOver: (event: PointerEvent) => void;
  onDoubleClick: (event: MouseEvent) => void;
  onInput: (event: Event) => void;
  onKeyDown: (event: KeyboardEvent) => void;
  onCopy: (event: ClipboardEvent) => void;
  onPaste: (event: ClipboardEvent) => void;
}

/** The cell a pointer event landed on, or null. */
function cellFromEvent(event: Event): GridCell | null {
  const cell = (event.target as Element | null)?.closest?.('[data-row][data-col]') as HTMLElement | null;
  if (!cell) return null;
  return { row: Number(cell.dataset.row), col: Number(cell.dataset.col) };
}

export function useGridInteraction({
  cells,
  width,
  selection,
  editor,
  scrollerRef,
  startEdit,
  onEditCell,
  setCopyState,
}: GridInteractionOptions): GridInteraction {
  const edit = editor.edit;
  const active = selection.active;

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const target = event.target as Element | null;
    if (target?.closest?.('[data-edit-input]')) return;
    // A click anywhere else closes the open editor first, so the click's own
    // meaning (select, drag, header) is what happens next.
    if (edit) editor.commit();
    const cell = cellFromEvent(event);
    if (cell) {
      scrollerRef.current?.focus();
      selection.begin(cell, event.shiftKey);
      event.preventDefault();
      return;
    }
    const column = target?.closest?.('[data-col-header]') as HTMLElement | null;
    if (column) {
      scrollerRef.current?.focus();
      selection.selectColumn(Number(column.dataset.colHeader), event.shiftKey);
      event.preventDefault();
      return;
    }
    const row = target?.closest?.('[data-row-header]') as HTMLElement | null;
    if (row) {
      scrollerRef.current?.focus();
      selection.selectRow(Number(row.dataset.rowHeader), event.shiftKey);
      event.preventDefault();
      return;
    }
    if (target?.closest?.('[data-corner]')) {
      scrollerRef.current?.focus();
      selection.selectAll();
      event.preventDefault();
    }
  };

  const onPointerOver = (event: PointerEvent) => {
    // `extendTo` reads the drag flag from a ref, not from this render's state:
    // the first pointerover can arrive before the pointerdown's state update
    // has been committed.
    const cell = cellFromEvent(event);
    if (cell) selection.extendTo(cell);
  };

  const onDoubleClick = (event: MouseEvent) => {
    const cell = cellFromEvent(event);
    if (cell) {
      startEdit('data', cell.row, cell.col);
      return;
    }
    const column = (event.target as Element | null)?.closest?.('[data-col-header]') as HTMLElement | null;
    if (column) startEdit('header', 0, Number(column.dataset.colHeader));
  };

  const onInput = (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (input.matches?.('[data-edit-input]')) editor.change(input.value);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (edit) {
      if (event.key === 'Enter') {
        event.preventDefault();
        editor.commit();
        selection.move(event.shiftKey ? -1 : 1, 0, false);
        return;
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        editor.commit();
        selection.move(0, event.shiftKey ? -1 : 1, false);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        editor.cancel();
        return;
      }
      return;
    }
    const meta = event.metaKey || event.ctrlKey;
    if (meta && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      selection.selectAll();
      return;
    }
    if (event.key === 'Escape') {
      selection.clear();
      return;
    }
    if (event.key === 'Enter' || event.key === 'F2') {
      if (!onEditCell || !active) return;
      event.preventDefault();
      startEdit('data', active.row, active.col);
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (!onEditCell || !active) return;
      event.preventDefault();
      onEditCell(active.row, active.col, '');
      return;
    }
    if (event.key.length === 1 && !meta && !event.altKey) {
      if (!onEditCell || !active) return;
      event.preventDefault();
      startEdit('data', active.row, active.col, event.key);
      return;
    }
    const step: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const delta = step[event.key];
    if (delta) {
      event.preventDefault();
      selection.move(delta[0], delta[1], event.shiftKey);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const column = event.key === 'Home' ? 0 : width - 1;
      const row = meta ? (event.key === 'Home' ? 0 : cells.length - 1) : (active?.row ?? 0);
      selection.move(row - (active?.row ?? 0), column - (active?.col ?? 0), event.shiftKey);
    }
  };

  // The browser's own copy event is the one Ctrl/Cmd+C and the context menu
  // both raise, so the payload is written there rather than in a key handler.
  //
  // An open cell editor OWNS the clipboard: while a value is being typed,
  // Ctrl/Cmd+C means "copy what I selected in the input", and hijacking it with
  // the cell range would make editing a cell with a copied fragment impossible.
  const onCopy = (event: ClipboardEvent) => {
    if (edit) return;
    if (!selection.range) return;
    event.clipboardData?.setData('text/plain', rangeToTsv(cells, selection.range));
    event.preventDefault();
    setCopyState('copied');
  };

  // A paste is REFUSED in words, not swallowed: the grid has no writer, and a
  // paste that silently did nothing would read as a broken clipboard.
  const onPaste = (event: ClipboardEvent) => {
    if (edit) return;
    event.preventDefault();
    setCopyState('refused');
  };

  return { onPointerDown, onPointerOver, onDoubleClick, onInput, onKeyDown, onCopy, onPaste };
}
