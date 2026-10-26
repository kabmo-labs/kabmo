/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Two panes and the divider between them.
 *
 * The split divides the width the editor panel ALREADY has — its fraction, its floor and
 * its diff variant are untouched — so nothing about the group's coupled-pair width model
 * changes. Splitting a column is a different decision from how wide the column is, and
 * keeping them apart is what made this feature cheap.
 *
 * ## The divider uses pointer capture
 *
 * A 3px handle is easy to leave mid-drag, and a listener on the handle alone would stop
 * receiving `pointermove` the moment the pointer crossed into a pane. Capture keeps the
 * events coming for the whole gesture, so a fast drag resizes instead of stalling.
 *
 * ## The position is a FRACTION
 *
 * A pixel width is only right on the display it was dragged on. The parent persists the
 * fraction and clamps it (`clampSplitFraction`), so neither pane can be squeezed out of
 * existence by a drag or by a hand-edited blob.
 */

import { useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

import { SplitPane } from '@/client/components/workspace/editor/SplitPane';
import { clampSplitFraction } from '@/shared/lib/workspace/split-editor';

interface SplitColumnProps {
  /** The divider's position, 0–1. */
  fraction: number;
  onFraction: (fraction: number) => void;
  rightPaneName: string;
  onClosePane: () => void;
  rightPane: ComponentChildren;
  /** The left pane — the panel body, strip included. */
  children: ComponentChildren;
}

export function SplitColumn({
  fraction,
  onFraction,
  rightPaneName,
  onClosePane,
  rightPane,
  children,
}: SplitColumnProps) {
  const columnRef = useRef<HTMLDivElement | null>(null);

  const startDrag = (event: PointerEvent) => {
    const handle = event.currentTarget as HTMLElement | null;
    const column = columnRef.current;
    if (!handle || !column) return;
    handle.setPointerCapture(event.pointerId);

    const move = (moveEvent: PointerEvent) => {
      const rect = column.getBoundingClientRect();
      // A zero-width column (a collapsed panel mid-transition) has no meaningful
      // fraction to compute, and dividing by it would write NaN into the session blob.
      if (rect.width === 0) return;
      onFraction(clampSplitFraction((moveEvent.clientX - rect.left) / rect.width));
    };
    const up = () => {
      handle.releasePointerCapture(event.pointerId);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  };

  return (
    <div ref={columnRef} className="flex w-full h-full" data-split-column="">
      <div
        className="flex flex-col min-w-0 h-full"
        style={{ width: `${Math.round(clampSplitFraction(fraction) * 100)}%` }}
      >
        {children}
      </div>
      <div
        className="w-[3px] flex-shrink-0 cursor-col-resize bg-ink/10 hover:bg-ink/40 transition-colors"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize split panes"
        onPointerDown={startDrag}
      />
      <div className="flex-1 min-w-0 h-full">
        <SplitPane fileName={rightPaneName} onClose={onClosePane}>
          {rightPane}
        </SplitPane>
      </div>
    </div>
  );
}
