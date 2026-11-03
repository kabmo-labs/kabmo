/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The editor panel's transient UI: the command palette, the go-to-line dialog,
 * quick open and Save As.
 *
 * One hook because these four are one decision — each is a thing the user is
 * doing RIGHT NOW, so none of them is persisted — and because the panel that
 * owns them also owns the chords that open them. Extracting them keeps
 * `index.tsx` under the per-file ceiling as the panel gained a review mode, and
 * it is the same split `use-editor-panel-keys` already makes for the keyboard.
 *
 * `goToLineRequest` is a COUNTER rather than a boolean: the dialog lives in the
 * document (where the caret and the handle are), so a boolean would need a
 * matching "closed" write from that side to be re-openable.
 */

import { useCallback, useState } from 'preact/hooks';

export interface EditorPanelUi {
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  /** Bumped once per request; the document opens the dialog when it moves. */
  goToLineRequest: number;
  openGoToLine: () => void;
  quickOpen: boolean;
  setQuickOpen: (open: boolean) => void;
  saveAsOpen: boolean;
  setSaveAsOpen: (open: boolean) => void;
}

export function useEditorPanelUi(): EditorPanelUi {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [goToLineRequest, setGoToLineRequest] = useState(0);
  const [quickOpen, setQuickOpen] = useState(false);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const openGoToLine = useCallback(() => setGoToLineRequest((previous) => previous + 1), []);

  return {
    paletteOpen,
    setPaletteOpen,
    goToLineRequest,
    openGoToLine,
    quickOpen,
    setQuickOpen,
    saveAsOpen,
    setSaveAsOpen,
  };
}
