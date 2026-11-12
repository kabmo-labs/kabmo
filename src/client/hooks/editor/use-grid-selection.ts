/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The selection state of the spreadsheet grid.
 *
 * Two cells, not one: the ANCHOR is where the selection started and the FOCUS
 * is where the pointer or the keyboard is now. A plain click collapses both
 * onto the same cell, a drag or a shift-click moves only the focus, and the
 * drawn range is the rectangle between them. Keeping the anchor is what makes
 * shift-click extend instead of restart, which is the behaviour every
 * spreadsheet has and the one a single `selected` cell cannot express.
 *
 * The hook owns no DOM: the grid delegates pointer events from one listener and
 * asks this for the verdict, so a 2000-row sheet does not mount 200 000
 * handlers.
 */

import { useCallback, useMemo, useRef, useState } from 'preact/hooks';
import {
  cellRange,
  clampCell,
  moveCell,
  selectAllRange,
  type GridCell,
  type GridRange,
} from '@/shared/lib/fs/grid-selection';

export interface GridSelection {
  /** The drawn rectangle, or null when nothing is selected. */
  range: GridRange | null;
  /** The cell the keyboard acts on, or null. */
  active: GridCell | null;
  /** True while a pointer drag is extending the selection. */
  dragging: boolean;
  /** Start a selection at `cell`; `extend` keeps the anchor (shift-click). */
  begin: (cell: GridCell, extend: boolean) => void;
  /** Move the focus while dragging. */
  extendTo: (cell: GridCell) => void;
  /** End a drag. */
  endDrag: () => void;
  /** Move the active cell by a delta; `extend` keeps the anchor. */
  move: (rowDelta: number, columnDelta: number, extend: boolean) => void;
  /** Select the whole grid. */
  selectAll: () => void;
  /** Select a whole column; `extend` keeps the anchor. */
  selectColumn: (col: number, extend: boolean) => void;
  /** Select a whole row; `extend` keeps the anchor. */
  selectRow: (row: number, extend: boolean) => void;
  /** Drop the selection. */
  clear: () => void;
}

export function useGridSelection(rowCount: number, columnCount: number): GridSelection {
  const [anchor, setAnchor] = useState<GridCell | null>(null);
  const [focus, setFocus] = useState<GridCell | null>(null);
  const [dragging, setDragging] = useState(false);
  // The pointer handlers read the live flag, not the render's copy: a
  // pointerover can arrive before the state update that started the drag has
  // been committed.
  const draggingRef = useRef(false);

  const clamp = useCallback(
    (cell: GridCell) => clampCell(cell, rowCount, columnCount),
    [rowCount, columnCount],
  );

  const begin = useCallback(
    (cell: GridCell, extend: boolean) => {
      const next = clamp(cell);
      if (extend && anchor) {
        setFocus(next);
      } else {
        setAnchor(next);
        setFocus(next);
      }
      draggingRef.current = true;
      setDragging(true);
    },
    [anchor, clamp],
  );

  const extendTo = useCallback(
    (cell: GridCell) => {
      if (!draggingRef.current) return;
      setFocus(clamp(cell));
    },
    [clamp],
  );

  const endDrag = useCallback(() => {
    draggingRef.current = false;
    setDragging(false);
  }, []);

  const move = useCallback(
    (rowDelta: number, columnDelta: number, extend: boolean) => {
      const from = focus ?? { row: 0, col: 0 };
      const next = moveCell(from, rowDelta, columnDelta, rowCount, columnCount);
      if (extend && anchor) {
        setFocus(next);
      } else {
        setAnchor(next);
        setFocus(next);
      }
    },
    [anchor, focus, rowCount, columnCount],
  );

  const selectAll = useCallback(() => {
    const all = selectAllRange(rowCount, columnCount);
    if (!all) return;
    setAnchor({ row: all.top, col: all.left });
    setFocus({ row: all.bottom, col: all.right });
  }, [rowCount, columnCount]);

  const selectColumn = useCallback(
    (col: number, extend: boolean) => {
      const next = clamp({ row: rowCount - 1, col });
      if (extend && anchor) {
        setFocus(next);
      } else {
        setAnchor(clamp({ row: 0, col }));
        setFocus(next);
      }
    },
    [anchor, clamp, rowCount],
  );

  const selectRow = useCallback(
    (row: number, extend: boolean) => {
      const next = clamp({ row, col: columnCount - 1 });
      if (extend && anchor) {
        setFocus(next);
      } else {
        setAnchor(clamp({ row, col: 0 }));
        setFocus(next);
      }
    },
    [anchor, clamp, columnCount],
  );

  const clear = useCallback(() => {
    setAnchor(null);
    setFocus(null);
  }, []);

  // The range is derived, and clamped on read: a sheet switch or a live CSV
  // edit can shrink the grid under a selection that was valid a render ago.
  const range = useMemo(() => {
    if (!anchor || !focus) return null;
    return cellRange(clamp(anchor), clamp(focus));
  }, [anchor, focus, clamp]);

  const active = useMemo(() => (focus ? clamp(focus) : null), [focus, clamp]);

  return { range, active, dragging, begin, extendTo, endDrag, move, selectAll, selectColumn, selectRow, clear };
}
