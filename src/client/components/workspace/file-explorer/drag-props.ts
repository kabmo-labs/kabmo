/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Files panel's drag-and-drop contract, shared by the panel and the row.
 *
 * Split from `TreeItem.tsx` because the panel owns every one of these and each
 * row only forwards them: declaring them once is what stops the two from
 * drifting on which of them a nested row must be handed. The behaviour lives in
 * `useFileRowDrag`; this file names what is handed down.
 */

import type { ClipboardTarget } from '@/client/hooks/workspace/file-clipboard';

export interface FileTreeDragProps {
  /** The row currently being dragged, or null. Panel state — see `useFileRowDrag`. */
  dragging: ClipboardTarget | null;
  /** A drag of this row started / ended / was dropped on `target`. */
  onDragStart: (target: ClipboardTarget) => void;
  onDragEnd: () => void;
  onDropOn: (target: ClipboardTarget) => void;
  /**
   * Split a collapsed chain row into one row per directory.
   *
   * A chain row's label names directories that are not rows at all, so they
   * cannot be dropped on or renamed. The panel calls this when a drag hovers an
   * accepting row and when the row's own menu asks for it.
   */
  onUnfold?: (target: ClipboardTarget) => void;
  /** Fold an unfolded chain back into the one row it is listed as. */
  onFold?: (deepestPath: string) => void;
  /**
   * Outermost level of each unfolded chain → the chain's deepest path.
   *
   * Only the outermost level offers Fold: it is the row the listing folds, and
   * the one that still reads as the chain's beginning once the levels inside it
   * are drawn separately.
   */
  foldRoots?: ReadonlyMap<string, string>;
}
