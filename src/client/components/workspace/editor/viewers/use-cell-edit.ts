/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The grid's inline cell editor: which cell is open, what has been typed, and
 * the two ways it closes.
 *
 * The draft is kept here rather than in the cell, because the cell is a memoised
 * row that must not re-render for a keystroke in a different row. The grid
 * renders the input from `edit`, and the input's own events are delegated from
 * the scroller like every other pointer/key event.
 *
 * A commit is only reported when the text actually changed: opening a cell and
 * pressing Enter must not mark the file dirty, which would make every glance at
 * a workbook look like an edit.
 */

import { useCallback, useState } from 'preact/hooks';

export type CellSection = 'data' | 'header';

export interface CellEdit {
  section: CellSection;
  /** Data row, or 0 for the header strip. */
  row: number;
  col: number;
  /** The text in the input. */
  value: string;
  /** The text the cell held when the editor opened. */
  initial: string;
}

export interface CellEditor {
  edit: CellEdit | null;
  begin: (section: CellSection, row: number, col: number, initial: string) => void;
  change: (value: string) => void;
  /** Close the editor, reporting the new value when it differs. */
  commit: () => void;
  /** Close the editor and keep the old value. */
  cancel: () => void;
}

export function useCellEdit(onCommit: (edit: CellEdit) => void): CellEditor {
  const [edit, setEdit] = useState<CellEdit | null>(null);

  const begin = useCallback((section: CellSection, row: number, col: number, initial: string) => {
    setEdit({ section, row, col, value: initial, initial });
  }, []);

  const change = useCallback((value: string) => {
    setEdit((previous) => (previous ? { ...previous, value } : previous));
  }, []);

  const commit = useCallback(() => {
    if (edit && edit.value !== edit.initial) onCommit(edit);
    setEdit(null);
  }, [edit, onCommit]);

  const cancel = useCallback(() => setEdit(null), []);

  return { edit, begin, change, commit, cancel };
}
