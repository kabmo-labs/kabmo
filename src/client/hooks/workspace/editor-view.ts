/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The desktop editor column's WIDTH mode, read and written through the session
 * slot every surface follows.
 *
 * Two surfaces read it — the layout (which collapses the columns) and both
 * toolbars (which draw the mode buttons) — so it goes through
 * `useSharedSessionState`: `useSessionState` hands each caller a private copy,
 * and a copy would leave the diff toolbar showing `normal` after the editor
 * toolbar entered compact view. A private copy is right for state one component
 * owns; this one is a decision two toolbars and the layout share.
 *
 * The stored mode only means anything while the editor column is OPEN. With it
 * closed the chat is the only thing on screen, and honouring the mode would
 * leave a blank workspace; the effective mode is therefore DERIVED rather than
 * written back, so closing and reopening the column returns the user to the
 * width they chose.
 */

import { useSharedSessionState } from '@/client/hooks/workspace/session-state';
import {
  DEFAULT_EDITOR_VIEW_MODE,
  EDITOR_VIEW_MODE_KEY,
  editorViewHides,
  isEditorViewMode,
  type EditorViewMode,
} from '@/shared/lib/workspace/editor-view-mode';

export interface EditorViewLayout {
  /** The mode in force, after the editor-open guard. */
  mode: EditorViewMode;
  /** The chat column is collapsed and the editor takes its width. */
  chatHidden: boolean;
  /** The session sidebar is collapsed as well (full view only). */
  sidebarHidden: boolean;
  /** Enter a mode, or return to `normal` — see `toggledEditorViewMode`. */
  setMode: (next: EditorViewMode) => void;
  /** Leave `full` for `compact`: the chat stays hidden, the sidebar returns. */
  revealSidebar: () => void;
}

export function useEditorViewLayout(editorOpen: boolean): EditorViewLayout {
  const [stored, setMode] = useSharedSessionState<EditorViewMode>(EDITOR_VIEW_MODE_KEY, DEFAULT_EDITOR_VIEW_MODE);
  const mode: EditorViewMode = editorOpen && isEditorViewMode(stored) ? stored : DEFAULT_EDITOR_VIEW_MODE;

  return {
    mode,
    chatHidden: editorViewHides(mode, 'chat'),
    sidebarHidden: editorViewHides(mode, 'sidebar'),
    setMode,
    // Only `full` hides the sidebar, so only `full` has anything to step back
    // from. A caller that asks for the sidebar (the navbar's own toggle) must be
    // able to call this unconditionally: turning `normal` into `compact` would
    // hide the chat for a user who only wanted their sidebar back.
    revealSidebar: () => setMode((previous) => (previous === 'full' ? 'compact' : previous)),
  };
}
