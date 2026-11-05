/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The phone's back gesture, in the one order the screens are stacked.
 *
 * Order is what the user sees, innermost first: the full-screen editor and diff
 * cover everything, then the settings sheet, then the drawer screens, and only
 * then does the shell walk WebView history. Without this, back reopened the
 * previous session while leaving the drawer that opened it on screen — the
 * screens live in component state, not in the URL, so nothing else could know
 * the order.
 *
 * A hook rather than an effect inline in the layout: it owns a subscription, and
 * the layout that calls it is already at the repo's size ceiling.
 */

import { useEffect } from 'preact/hooks';
import { registerBackHandler } from '@/client/lib/native/back';

export interface MobileBackStack {
  /** The full-screen editor is open. */
  editorOpen: boolean;
  /** The full-screen diff is open. */
  diffOpen: boolean;
  /** The settings sheet is open. */
  settingsOpen: boolean;
  /** Anything other than the chat screen is showing. */
  offMainScreen: boolean;
  onCloseEditor: () => void;
  onCloseDiff: () => void;
  onCloseSettings: () => void;
  onReturnToMain: () => void;
}

export function useMobileBackStack(stack: MobileBackStack): void {
  const {
    editorOpen,
    diffOpen,
    settingsOpen,
    offMainScreen,
    onCloseEditor,
    onCloseDiff,
    onCloseSettings,
    onReturnToMain,
  } = stack;

  useEffect(() => {
    return registerBackHandler(() => {
      if (editorOpen) {
        onCloseEditor();
        return true;
      }
      if (diffOpen) {
        onCloseDiff();
        return true;
      }
      if (settingsOpen) {
        onCloseSettings();
        return true;
      }
      if (offMainScreen) {
        onReturnToMain();
        return true;
      }
      return false;
    });
  }, [editorOpen, diffOpen, settingsOpen, offMainScreen, onCloseEditor, onCloseDiff, onCloseSettings, onReturnToMain]);
}
