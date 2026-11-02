/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Files panel's BACKGROUND as a drop target — the listing root.
 *
 * It is a target like any other row: it is the only way to move an entry back
 * out of a folder, since a drop on a file lands in that file's own directory
 * instead. Two facts decide its shape:
 *
 * - **The tint is the POINTER, not the capability.** `accepts` is true from the
 *   instant a drag starts, so tinting on it painted the whole tree blue for the
 *   entire gesture and read as "every row is selected". The tint follows the
 *   pointer being on the background's own drop area.
 * - **A row between two gaps claims `dragover` with `stopPropagation`**, so the
 *   reach that matters here is `dragenter`: it fires whenever the pointer moves
 *   off a row and back onto bare background. `dragleave` therefore ignores a
 *   move onto a CHILD — the pointer is still inside the scroller, and it is
 *   about to be claimed by the row it landed on.
 */

import { useEffect, useState } from 'preact/hooks';
import type { TargetedDragEvent } from 'preact';
import type { ClipboardTarget, FileClipboard } from '@/client/hooks/workspace/file-clipboard';

export interface RootDropTargetOptions {
  /** The row the tree is currently dragging, or null. */
  dragging: ClipboardTarget | null;
  clipboard: FileClipboard;
  /** The listing root's own identity — `.` and a folder. */
  target: ClipboardTarget;
}

export interface RootDropTarget {
  /** Whether the background would accept the drag in flight. */
  accepts: boolean;
  /** Whether the pointer is on the background AND it would accept the drag. */
  highlighted: boolean;
  onDragEnter: () => void;
  onDragLeave: (e: TargetedDragEvent<HTMLElement>) => void;
  onDragOver: (e: TargetedDragEvent<HTMLElement>) => void;
  onDrop: (e: TargetedDragEvent<HTMLElement>) => void;
}

export function useRootDropTarget({ dragging, clipboard, target }: RootDropTargetOptions): RootDropTarget {
  const accepts = Boolean(dragging) && clipboard.moveRefusalFor(dragging!, target) === null;
  const [hovered, setHovered] = useState(false);
  // A drag that ended (dropped, cancelled, or left the window) leaves nothing
  // hovering, and `dragleave` is not guaranteed for the element it ended on.
  useEffect(() => {
    if (!dragging) setHovered(false);
  }, [dragging]);

  return {
    accepts,
    highlighted: hovered && accepts,
    onDragEnter: () => {
      if (dragging) setHovered(true);
    },
    onDragLeave: (e) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHovered(false);
    },
    onDragOver: (e) => {
      if (!accepts) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    },
    onDrop: (e) => {
      if (!accepts) return;
      e.preventDefault();
      setHovered(false);
      clipboard.move(dragging!, target);
    },
  };
}
