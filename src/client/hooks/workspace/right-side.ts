/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which parts of the RIGHT side of the workspace are on screen: the editor
 * column, the right panel, and the activity rail that switches views.
 *
 * They are one decision now, not three. The navbar's toggle used to put away
 * only the right panel, so the rail stayed behind as a column of marks beside a
 * collapsed panel, and the editor kept its width; hiding the whole side is what
 * gives a reader the chat alone, and the same click brings all of it back.
 *
 * Two rules the hook exists to keep in ONE place:
 *
 * - **`hidden` remembers nothing else.** The panel's own switch and the
 *   editor's own switch are still stored per session, so the side comes back
 *   the way it was left when something asks for it (a plugin opening its
 *   panel, a file being opened). The navbar's toggle is the exception and says
 *   so: it SHOWS everything, because a click that restored a half-hidden side
 *   would look like it did nothing.
 * - **The editor's width mode is derived from the editor's own flag**, not from
 *   `hidden` — the layout passes the effective `showEditor` into
 *   `useEditorViewLayout`, so putting the side away returns the chat at the
 *   width the user chose rather than at a stale mode.
 */

import { useCallback } from 'preact/hooks';
import { useSessionState } from '@/client/hooks/workspace/session-state';

export interface RightSideLayoutOptions {
  /** The editor column has something to open on to (a tab, a takeover). */
  editorHasContent: boolean;
  /** What the column does when the user has never toggled it. */
  editorOpensByDefault: boolean;
  /** Boot-time defaults, for a session that has never stored a layout. */
  showRightPanelInitially?: boolean;
  userToggledEditorInitially?: boolean | null;
}

export interface RightSideLayout {
  /** The right panel is open AND the side is not put away. */
  showRightPanel: boolean;
  showEditor: boolean;
  /**
   * The whole right side is put away: the editor column, the right panel and
   * the activity rail. The chat keeps the width and the rail comes back with
   * the rest.
   */
  hidden: boolean;
  /** The navbar's toggle: hide everything, or show everything back. */
  toggleRightSide: () => void;
  /** The panel's own close control: that column only. */
  closeRightPanel: () => void;
  /** Open the right panel (a view was picked). */
  revealRightPanel: () => void;
  /** The editor column's own switch, from the chord or the palette. */
  toggleEditor: () => void;
  hideEditor: () => void;
  /** A file was opened, or a takeover picked: the column must be on screen. */
  revealEditor: () => void;
}

export function useRightSideLayout({
  editorHasContent,
  editorOpensByDefault,
  showRightPanelInitially = true,
  userToggledEditorInitially = null,
}: RightSideLayoutOptions): RightSideLayout {
  const [rightPanelOpen, setRightPanelOpen] = useSessionState<boolean>('layout.showRightPanel', showRightPanelInitially);
  const [userToggledEditor, setUserToggledEditor] = useSessionState<boolean | null>(
    'layout.userToggledEditor',
    userToggledEditorInitially,
  );
  // Per session, like every other layout choice: two chats may be read
  // differently, and a reload returns the reader to the side they left.
  const [hidden, setHidden] = useSessionState<boolean>('layout.rightSideHidden', false);

  const revealRightPanel = useCallback(() => {
    setRightPanelOpen(true);
    setHidden(false);
  }, [setRightPanelOpen, setHidden]);
  const closeRightPanel = useCallback(() => setRightPanelOpen(false), [setRightPanelOpen]);
  const revealEditor = useCallback(() => {
    setUserToggledEditor(true);
    setHidden(false);
  }, [setUserToggledEditor, setHidden]);
  const hideEditor = useCallback(() => setUserToggledEditor(false), [setUserToggledEditor]);
  /** The column's own switch, with the side's memory left out of it. */
  const editorWanted = editorHasContent && (userToggledEditor ?? editorOpensByDefault);
  const showEditor = editorWanted && !hidden;

  /**
   * The editor's own switch (`⌘J`, the palette, the panel's corner button).
   *
   * It acts on what is ON SCREEN, so it must reveal the side when the side is
   * what is hiding the column; otherwise the chord would write a flag the
   * layout is ignoring and look dead.
   */
  const toggleEditor = useCallback(() => {
    if (!showEditor) {
      setHidden(false);
      setUserToggledEditor(true);
      return;
    }
    setUserToggledEditor(false);
  }, [showEditor, setUserToggledEditor, setHidden]);

  /**
   * One click puts the whole side away; the next shows all of it.
   *
   * "Any part visible" is the test, not the flag alone: a reader who closed
   * the right panel with its own control still has the editor column and the
   * rail on screen, so the same button must put those away rather than look
   * like it opened a panel that stayed closed. Coming back, everything
   * returns — an open panel and the editor column — because the button's
   * promise is the side, not the half of it that happened to be open. A blank
   * editor column is not forced open: there is nothing to show.
   */
  const toggleRightSide = useCallback(() => {
    if (!hidden && (editorWanted || rightPanelOpen)) {
      setHidden(true);
      return;
    }
    setRightPanelOpen(true);
    if (editorHasContent) setUserToggledEditor(true);
    setHidden(false);
  }, [hidden, editorWanted, rightPanelOpen, setHidden, setRightPanelOpen, setUserToggledEditor, editorHasContent]);

  return {
    showRightPanel: rightPanelOpen && !hidden,
    showEditor,
    hidden,
    toggleRightSide,
    closeRightPanel,
    revealRightPanel,
    toggleEditor,
    hideEditor,
    revealEditor,
  };
}
