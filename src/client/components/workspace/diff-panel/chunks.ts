/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Stepping through a diff's changed chunks.
 *
 * Split out of `merge.ts` for the per-file ceiling, and it earns the boundary:
 * everything here is a question about a LIVE view's selection, while `merge.ts`
 * owns mounting and reconfiguring the two shapes.
 *
 * Three facts are load-bearing, and none is guessable:
 *
 * - `getChunks` is a FUNCTION on the state and answers `null` for a state with
 *   no merge extension. `state.field(getChunks)` throws "Field is not present
 *   in this state", and a null treated as "no changes" reads as an empty diff.
 * - The side matters. A split view's B editor is the working file and reports
 *   `side: 'b'`; a unified view also reports `'b'` (it renders the new
 *   document). Reading `fromA` on a `'b'` view measures the wrong document.
 * - The package's own `goToNextChunk` moves the SELECTION and scrolls through
 *   `scrollIntoView` on the range — which is not enough on a read-only reader,
 *   so the row is centred again after the move.
 */

import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { goToNextChunk, goToPreviousChunk, getChunks } from '@codemirror/merge';

/** The chunk the selection is in (`index` 0-based, or -1), and how many exist. */
export interface ChunkPosition {
  index: number;
  count: number;
}

/** `StateCommand`'s shape as this module invokes it (see `keymap.ts`). */
type ViewCommand = (view: EditorView) => boolean;

/**
 * The chunk the selection is in, and how many there are.
 *
 * A pair rather than two calls because they are read in one render: a caller
 * that fetched them separately could print "3 of 2" after a document swap.
 */
export function chunkPositionOf(view: EditorView): ChunkPosition {
  const field = getChunks(view.state);
  if (!field || field.chunks.length === 0) return { index: -1, count: 0 };
  const head = view.state.selection.main.head;
  const index = field.chunks.findIndex((chunk) =>
    field.side === 'a'
      ? head >= chunk.fromA && head <= chunk.toA
      : head >= chunk.fromB && head <= chunk.toB,
  );
  return { index, count: field.chunks.length };
}

/**
 * Step to the next/previous chunk and bring it into view.
 *
 * False when there is nowhere to go — no chunks at all, or the caret already
 * inside the only one — so a caller can leave a control inert.
 */
export function stepChunkIn(view: EditorView, direction: 1 | -1): boolean {
  const command = (direction === 1 ? goToNextChunk : goToPreviousChunk) as unknown as ViewCommand;
  const moved = command(view);
  if (moved) {
    const head = view.state.selection.main.head;
    view.dispatch({ effects: EditorView.scrollIntoView(head, { y: 'center' }) });
  }
  return moved;
}

/**
 * Report the selection's chunk on every update that moves it.
 *
 * Attached to ONE view per shape (the B side of a split, the single view of a
 * unified diff): both sides of a split carry the chunk field, and two reporters
 * would race for the same toolbar label.
 */
export function chunkReporter(report: (position: ChunkPosition) => void): Extension {
  return EditorView.updateListener.of((update) => {
    if (!update.docChanged && !update.selectionSet) return;
    report(chunkPositionOf(update.view));
  });
}
