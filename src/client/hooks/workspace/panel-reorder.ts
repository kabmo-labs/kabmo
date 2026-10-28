/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Drag-reorder for the right-panel buttons.
 *
 * Extracted from `RightActivityBar` because it is a stateful cluster of
 * handlers sharing one decision, and the decision is subtle enough to deserve
 * its own place: **the order is built in a ref and committed once, on the drop.**
 *
 * Two platform facts drive the shape:
 *
 * - **`dataTransfer.getData()` returns an empty string until the drop.** A row
 *   therefore cannot ask the event what is being dragged, so the id in flight is
 *   panel state, and every row reads it from there.
 * - **`dragover` fires before the re-render a state write schedules.** A second
 *   `dragover` inside that window would read the pre-drag order and compute the
 *   move from it, so the row would jump back to where the drag began. The ref
 *   holds the running order; the state copy exists only so React draws it.
 *
 * The commit hangs off `drop`, never off `dragend`. `dragend` fires for a
 * cancelled gesture too, and the only signal that distinguishes the two there is
 * `dropEffect` — which a browser resets to `'none'` on a `dragend` that had no
 * drop, and which is `'move'`/`'copy'` only while a `dragover` is still in
 * progress. `drop` is the platform's own "this gesture was accepted" event, so
 * reading it there needs no such inference.
 *
 * Committing on every `dragover` is the other failure this avoids: the order is
 * a global setting, so that shape would POST a settings write per row the cursor
 * passed over.
 */
import { useCallback, useRef, useState } from 'preact/hooks';
import type { TargetedDragEvent } from 'preact';
import { movePanel } from '@/shared/lib/workspace/panel-order';

interface DragState {
  /** The row being dragged. */
  id: string;
  /** The order built so far, or null while the cursor has not moved off the row. */
  order: string[] | null;
}

export interface PanelReorder {
  /** The order to draw: the drag in progress, or `ids` when none is. */
  order: readonly string[];
  /** The row being dragged, so it can be dimmed. */
  draggingId: string | null;
  onDragStart: (event: TargetedDragEvent<HTMLElement>, id: string) => void;
  onDragOver: (event: TargetedDragEvent<HTMLElement>, id: string) => void;
  onDrop: (event: TargetedDragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}

/**
 * `commit` receives the order the bar DREW before the drag and the order it drew
 * after, rather than just the result: the bar can only drag what it draws, and
 * what it does not draw (a panel switched off, a plugin whose bundle has not
 * loaded) must keep its place in the stored order.
 */
export function usePanelReorder(
  ids: readonly string[],
  commit: (visibleIds: readonly string[], nextVisible: readonly string[]) => void,
): PanelReorder {
  // The ids the bar currently draws, held in a ref so the handlers keep ONE
  // identity: `ids` is rebuilt from the catalog on every render, and a callback
  // that closed over it would be a new function per render, which Preact would
  // then re-attach to every row.
  const idsRef = useRef(ids);
  idsRef.current = ids;

  const dragRef = useRef<DragState | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const onDragStart = useCallback((event: TargetedDragEvent<HTMLElement>, id: string) => {
    // The payload is what a drag OUT of the bar reads (an editor, another
    // surface); the reorder itself reads the ref, for the reason above.
    event.dataTransfer?.setData('text/plain', id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    const next = { id, order: null };
    dragRef.current = next;
    setDrag(next);
  }, []);

  const onDragOver = useCallback((event: TargetedDragEvent<HTMLElement>, id: string) => {
    const current = dragRef.current;
    if (!current || current.id === id) return;
    // Required: without it the browser refuses the drop.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const next = { id: current.id, order: movePanel(current.order ?? idsRef.current, current.id, id) };
    dragRef.current = next;
    setDrag(next);
  }, []);

  const onDrop = useCallback(
    (event: TargetedDragEvent<HTMLElement>) => {
      const current = dragRef.current;
      if (!current?.order) return;
      // The drop is the gesture's acceptance, so the row must not let the event
      // bubble on to the bar behind it.
      event.preventDefault();
      event.stopPropagation();
      dragRef.current = null;
      setDrag(null);
      commit(idsRef.current, current.order);
    },
    [commit],
  );

  /** Clear a cancelled gesture — no drop, so nothing is written. */
  const onDragEnd = useCallback(() => {
    dragRef.current = null;
    setDrag(null);
  }, []);

  return { order: drag?.order ?? ids, draggingId: drag?.id ?? null, onDragStart, onDragOver, onDrop, onDragEnd };
}
