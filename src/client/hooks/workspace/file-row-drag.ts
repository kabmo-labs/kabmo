/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One Files-panel row as a drag SOURCE and a drop TARGET.
 *
 * Extracted from `FileTreeItem` because it is a stateful cluster of four
 * handlers sharing one decision, and because the decision is subtle enough to
 * deserve its own place: **a drag is a move, and `dragover` is the only moment a
 * target may refuse.**
 *
 * Two facts about the platform drive the whole shape:
 *
 * - **`dataTransfer.getData()` returns an empty string until the drop.** A
 *   target therefore cannot ask the event what is being dragged, so the entry
 *   in flight is PANEL state (`dragging`, owned by the tree) and every row reads
 *   it from there.
 * - **`preventDefault` in `dragover` is what accepts the drop.** Not calling it
 *   is the refusal — and that is also what keeps the browser from drawing a drop
 *   cursor over a drop it will not perform. So a row that cannot accept the
 *   entry declines, while still CLAIMING the event (`stopPropagation`): the
 *   panel's background is a target too (the listing root), and a row that let
 *   the event bubble would silently move the entry to the root — dragging a file
 *   onto the folder it already sits in would move it out.
 */

import type { TargetedDragEvent } from 'preact';
import type { ClipboardTarget, FileClipboard } from '@/client/hooks/workspace/file-clipboard';

export interface FileRowDragOptions {
  /** This row's identity, as a drag source and as a drop target. */
  target: ClipboardTarget;
  /** The row the tree is currently dragging, or null. */
  dragging: ClipboardTarget | null;
  /** The panel's clipboard, for the move rule and the request. */
  clipboard: FileClipboard;
  /** A drag of this row started / ended / was dropped on this row. */
  onDragStart: (target: ClipboardTarget) => void;
  onDragEnd: () => void;
  onDropOn: (target: ClipboardTarget) => void;
}

export interface FileRowDrag {
  /** True while this row is the one being dragged. */
  isDragging: boolean;
  /** True while this row would accept the drag in flight. */
  acceptsDrop: boolean;
  onDragStart: (e: TargetedDragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDragOver: (e: TargetedDragEvent<HTMLElement>) => void;
  onDrop: (e: TargetedDragEvent<HTMLElement>) => void;
}

export function useFileRowDrag({
  target,
  dragging,
  clipboard,
  onDragStart,
  onDragEnd,
  onDropOn,
}: FileRowDragOptions): FileRowDrag {
  const isDragging = dragging?.path === target.path;
  const acceptsDrop = Boolean(dragging) && !isDragging && clipboard.moveRefusalFor(dragging!, target) === null;

  return {
    isDragging,
    acceptsDrop,
    onDragStart: (e) => {
      // The tree's own payload is what a drop INSIDE the panel reads, and
      // `text/plain` carries the path so a drag out to another surface (a
      // terminal, an editor) still names something.
      e.dataTransfer?.setData('text/plain', target.path);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      onDragStart(target);
    },
    onDragEnd,
    onDragOver: (e) => {
      // Not this panel's drag (an OS file drag, a drag from elsewhere): the row
      // has no opinion, and the event belongs to whatever else is listening.
      if (!dragging) return;
      // Claimed even when refused — see the module doc: the background is the
      // root's target, and letting this bubble would move the entry there.
      e.stopPropagation();
      if (!acceptsDrop) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    },
    onDrop: (e) => {
      if (!dragging) return;
      e.stopPropagation();
      if (!acceptsDrop) return;
      e.preventDefault();
      onDropOn(target);
    },
  };
}
