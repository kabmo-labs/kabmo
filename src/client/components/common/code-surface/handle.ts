/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The imperative surface handle, built from the mount's refs.
 *
 * Split out of `index.tsx` because the component is at the repository's line
 * ceiling and this half is dispatch, not rendering: every method here is "look
 * up the live view, then hand CodeMirror a transaction". Keeping it a factory
 * over the refs (rather than a hook) is what makes the identity stable — the
 * handle is built once for the component's life, so a consumer holding it never
 * re-subscribes.
 *
 * Two rules live here and nowhere else, both measured:
 *
 * - **`applyDocument` is a USER edit.** It is deliberately not silenced as an
 *   external write: the find bar's replace has to reach `onValueChange` exactly
 *   like typing does, or the parent keeps the pre-replace buffer and the next
 *   render writes the OLD text back over it.
 * - **A reveal cancels a pending scroll restore.** The restore's
 *   `ResizeObserver` can run BEFORE the scroll event a reveal's dispatch causes,
 *   so it would write the remembered offset back and the view would never move.
 */

import { EditorView } from '@codemirror/view';
import type { MutableRef } from '@/client/components/common/code-surface/sync';
import { cancelScrollRestore } from '@/client/hooks/editor/use-scroll-restore';
import { runSurfaceCommand } from '@/client/components/common/code-surface/keymap';
import type { EditorCommand } from '@/shared/lib/code/editor/keymap';

/** The imperative surface every consumer of the editor holds. */
export interface CodeSurfaceHandle {
  /** Current selection offsets in the buffer, or null before the view mounts. */
  getSelection(): { start: number; end: number } | null;
  /** Select `[start, end)`; `focus` moves keyboard focus into the editor. */
  select(start: number, end: number, focus?: boolean): void;
  /** Replace the buffer as one undoable edit, caret at `[caretStart, caretEnd)`, focus unchanged. */
  applyDocument(value: string, caretStart: number, caretEnd: number): void;
  /** Run an editor command by name (the palette's path into the editor). */
  runCommand(command: EditorCommand): void;
  /**
   * Bring the line holding `offset` into view WITHOUT moving the caret — what
   * "step to the next match" needs: the user's focus stays in the find field
   * while the match scrolls under it.
   */
  revealOffset(offset: number): void;
}

export interface SurfaceHandleRefs {
  view: MutableRef<EditorView | null>;
  /** The live `onCommand`, mirrored so the handle never captures a stale one. */
  onCommand: MutableRef<((command: EditorCommand) => void) | undefined>;
}

/** The handle a `forwardRef` caller receives. Built once per mount. */
export function createSurfaceHandle({ view: viewRef, onCommand: onCommandRef }: SurfaceHandleRefs): CodeSurfaceHandle {
  return {
    getSelection: () => {
      const view = viewRef.current;
      if (!view) return null;
      const range = view.state.selection.main;
      return { start: range.from, end: range.to };
    },
    select: (start, end, focus = true) => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({ selection: { anchor: start, head: end }, scrollIntoView: false });
      // `focus()` is CM6's own `focusPreventScroll`, which is what stops the
      // browser scrolling the caret into view a second time — the caller's
      // `revealOffset` is the only thing that scrolls.
      if (focus) view.focus();
    },
    applyDocument: (next, caretStart, caretEnd) => {
      const view = viewRef.current;
      if (!view) return;
      // One transaction, so ⌘Z undoes the whole replacement: a replace-all that
      // took one undo step per match is what the old surface had to hand-roll a
      // history for.
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next },
        selection: { anchor: caretStart, head: caretEnd },
      });
    },
    runCommand: (command) => {
      const view = viewRef.current;
      if (!view) return;
      runSurfaceCommand(command, view, onCommandRef.current);
    },
    revealOffset: (offset) => {
      const view = viewRef.current;
      if (!view) return;
      const at = Math.max(0, Math.min(offset, view.state.doc.length));
      cancelScrollRestore(view.scrollDOM);
      // `y: 'nearest'` is the rule the old surface hand-rolled: a reveal only
      // scrolls when the target is outside the visible band, so stepping
      // through matches does not jump the whole view on every step.
      view.dispatch({ effects: EditorView.scrollIntoView(at, { y: 'nearest', yMargin: 24 }) });
    },
  };
}
