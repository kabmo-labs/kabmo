/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The editor panel's keyboard surface, as one hook.
 *
 * Three things live here because they are one decision: what the panel CONSUMES
 * before the document sees it. The panel is the scope, not the window — another
 * panel's text field keeps its own ⌘F and the composer is untouched — and only the
 * commands the PANEL owns are consumed here, because the editor's own keymap runs
 * inside the document where it has the buffer and the caret in hand.
 *
 * ## Capture is the mechanism
 *
 * The contenteditable has CodeMirror's handlers (the generated keymap, and
 * `defaultKeymap` behind it) and would see these chords first otherwise. Capture
 * on the panel's own root is what puts them in front, and it is also why the
 * panel is the scope: the listener is on a container, not on `window`.
 *
 * ## ⌘S is the one chord handled on the WINDOW
 *
 * It has to work while focus is anywhere in the panel — including a field the
 * panel does not own — and a browser's own Save dialog is the alternative. It is
 * registered once and reads the save callback through a ref, so a re-render does
 * not detach and reattach it.
 */

import { useCallback, useEffect, useRef } from 'preact/hooks';
import type { TargetedKeyboardEvent } from 'preact';

import { EDITOR_KEY_BINDINGS, isFindBarCommand, type EditorCommand } from '@/shared/lib/code/editor/keymap';
import { resolveBinding } from '@/shared/lib/ui/key-binding';

interface UseEditorPanelKeysOptions {
  find: {
    open: boolean;
    close: () => void;
    runCommand: (command: EditorCommand) => void;
  };
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  runCommand: (command: EditorCommand) => void;
  saveNow: () => void;
  /** Open the file picker. `⌘P` is about the WORKSPACE, not the buffer. */
  openQuickOpen: () => void;
  /** Restore the most recently closed tab; returns false with an empty stack. */
  reopenClosed?: () => boolean;
}

export interface EditorPanelKeys {
  /** Spread on the panel's root: the capture-phase dispatch. */
  onKeyDownCapture: (event: TargetedKeyboardEvent<HTMLDivElement>) => void;
}

export function useEditorPanelKeys({
  find,
  paletteOpen,
  setPaletteOpen,
  runCommand,
  saveNow,
  openQuickOpen,
  reopenClosed,
}: UseEditorPanelKeysOptions): EditorPanelKeys {
  // The handler is rebuilt every render (it reads live find state), so the ref is
  // what keeps the window listener attached once.
  const findRef = useRef(find);
  findRef.current = find;
  const paletteRef = useRef({ paletteOpen, setPaletteOpen });
  paletteRef.current = { paletteOpen, setPaletteOpen };
  const runRef = useRef(runCommand);
  runRef.current = runCommand;

  const saveRef = useRef(saveNow);
  saveRef.current = saveNow;
  const quickOpenRef = useRef(openQuickOpen);
  quickOpenRef.current = openQuickOpen;
  const reopenRef = useRef(reopenClosed);
  reopenRef.current = reopenClosed;

  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key !== 's') return;
      // The browser's Save dialog is never what the user meant.
      event.preventDefault();
      saveRef.current();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const onKeyDownCapture = useCallback((event: TargetedKeyboardEvent<HTMLDivElement>) => {
    const current = findRef.current;
    const palette = paletteRef.current;

    if (event.key === 'Escape') {
      if (palette.paletteOpen) {
        event.preventDefault();
        event.stopPropagation();
        palette.setPaletteOpen(false);
        return;
      }
      if (!current.open) return;
      event.preventDefault();
      event.stopPropagation();
      current.close();
      return;
    }

    // ⌘⇧T restores the last closed tab. Checked BEFORE ⌘⇧P for the same reason: a
    // chord pair that differs only by its letter must not both match.
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.code === 'KeyT') {
      // Only consumed when there IS something to restore, so an empty stack leaves the
      // key to the browser rather than swallowing it.
      if (reopenRef.current?.()) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    // ⌘P opens the file picker, and it is checked BEFORE ⌘⇧P: the shift test below
    // excludes it, so the two cannot both fire, but the reader should see the pair
    // together.
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.code === 'KeyP') {
      event.preventDefault();
      event.stopPropagation();
      quickOpenRef.current();
      return;
    }

    // ⌘⇧P opens the palette — the one chord that is not an editor command.
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.code === 'KeyP') {
      event.preventDefault();
      event.stopPropagation();
      palette.setPaletteOpen(true);
      return;
    }

    // While the bar is open, an unmodified key in one of ITS fields belongs to the
    // field — but F3 and the ⌘-chords below still dispatch, so stepping to the
    // next match from inside the find field works.
    const command = resolveBinding(EDITOR_KEY_BINDINGS, event);
    if (!command || !isFindBarCommand(command)) return;
    event.preventDefault();
    event.stopPropagation();
    runRef.current(command);
  }, []);

  return { onKeyDownCapture };
}
