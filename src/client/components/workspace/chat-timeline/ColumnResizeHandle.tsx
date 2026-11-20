/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The grip on the chat column's right edge: hover it, hold, drag.
 *
 * It paints NOTHING persistent — no hairline, no handle, no marker. The only
 * affordance is the `col-resize` cursor over a 12px strip along the column's
 * edge, and while a drag runs the column's own edge is the feedback (both edges
 * move, because the column is centred). A drawn line was explicitly rejected:
 * the edge of a reading column is already a real boundary, and a second line
 * beside it would claim two.
 *
 * The strip is positioned from MEASURED rects, not from CSS arithmetic. The
 * column's right edge depends on the scroller's scrollbar (8px of layout in
 * this app), its padding, and the column's own centring; a `calc()` here would
 * be a second statement of three facts the scroller already owns, and it drifted
 * by 4px the moment the bar was present. A `ResizeObserver` on the column and on
 * the surface keeps the strip on the edge through a window resize, a mode change
 * and every frame of a live drag — the drag writes the CSS variable, the column
 * resizes, the observer follows.
 *
 * Not drawn on a phone (`isMobile`): the column already fills the screen there,
 * so the grip would have nothing to widen into.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { MAX_CHAT_COLUMN_WIDTH, MIN_CHAT_COLUMN_WIDTH } from '@/shared/lib/chat/timeline/width-mode';
import { chatColumnFor, useColumnDrag } from '@/client/hooks/chat/timeline/column-drag';

/** Width of the strip, and the distance its right side is held off the column. */
const GRIP_WIDTH = 12;

interface ColumnResizeHandleProps {
  isMobile: boolean;
}

/** The column's right edge, as the surface sees it, plus the width it has. */
function useColumnGeometry(ref: { current: HTMLElement | null }): { offset: number; width: number } | null {
  const [geometry, setGeometry] = useState<{ offset: number; width: number } | null>(null);

  useEffect(() => {
    const grip = ref.current;
    const surface = grip?.parentElement;
    const column = grip ? chatColumnFor(grip) : null;
    if (!surface || !column) return;

    const measure = () => {
      const surfaceRect = surface.getBoundingClientRect();
      const columnRect = column.getBoundingClientRect();
      const next = {
        offset: Math.max(0, Math.round(surfaceRect.right - columnRect.right)),
        width: Math.round(columnRect.width),
      };
      // The observer fires for HEIGHT too, and a streaming answer grows the
      // column on every chunk: re-rendering on an unchanged edge would be a
      // render per token for a strip that did not move.
      setGeometry((prev) => (prev && prev.offset === next.offset && prev.width === next.width ? prev : next));
    };
    measure();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(column);
    observer.observe(surface);
    return () => observer.disconnect();
  }, []);

  return geometry;
}

export function ColumnResizeHandle({ isMobile }: ColumnResizeHandleProps) {
  const drag = useColumnDrag();
  const gripRef = useRef<HTMLDivElement | null>(null);
  const geometry = useColumnGeometry(gripRef);

  return (
    <div
      ref={gripRef}
      data-chat-column-grip=""
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize chat column"
      aria-valuemin={MIN_CHAT_COLUMN_WIDTH}
      aria-valuemax={MAX_CHAT_COLUMN_WIDTH}
      aria-valuenow={geometry?.width ?? undefined}
      title="Drag to resize the chat column"
      tabIndex={0}
      onPointerDown={drag.onPointerDown}
      onKeyDown={drag.onKeyDown}
      // The strip lies OUTSIDE the column, in the empty centring gap, and stops
      // at the column's edge. A strip centred on the edge was unreachable: the
      // composer card spans the column and paints above it (`z-30`), so a press
      // at the grip's own centre landed in the card's textarea and the drag
      // never started. In the gap there is nothing to overlap.
      //
      // `z-10` is DELIBERATE: the jump rail (`z-20`) owns the panel's right
      // edge, and with the column at full width the gap is zero — the rail's
      // 24px column stays clickable and the rest of the height is still
      // draggable.
      className={`${isMobile ? 'hidden' : 'block'} absolute top-0 bottom-0 z-10 w-3 cursor-col-resize touch-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink/40`}
      style={geometry === null ? { display: 'none' } : { right: `${Math.max(0, geometry.offset - GRIP_WIDTH)}px` }}
    />
  );
}
