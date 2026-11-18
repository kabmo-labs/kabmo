/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The terminal's own copy paths, beside the chords ghostty-web implements.
 *
 * Two platforms deliver copy differently and neither is `Meta+C`:
 *
 * - **macOS shell**: the Edit menu claims ⌘C, so the page never sees the
 *   keydown — the native `copy:` action fires a DOM `copy` event on the
 *   focused element instead. `installTerminalCopy` answers that event with the
 *   canvas selection, which the native action would otherwise replace with the
 *   (empty) DOM selection.
 * - **Windows and Linux**: there is no native Edit menu in the way, but
 *   ghostty-web binds copy to `Meta+C` only, and `Ctrl+C` must stay SIGINT.
 *   `installTerminalCopyChords` adds the terminal convention,
 *   `Ctrl+Shift+C` / `Ctrl+Shift+V`, in the CAPTURE phase so ghostty's encoder
 *   never sees the chord and sends a control byte instead.
 *
 * `clipboardData.setData` is the synchronous path the `copy` event exists for;
 * the async clipboard API is the fallback for a platform that hands the event
 * no `DataTransfer`.
 */

import { copyToClipboard, readClipboardText } from '@/client/hooks/ui/clipboard';

/** Copy the canvas selection when the platform's copy command fires `copy`. */
export function installTerminalCopy(
  container: HTMLElement,
  getSelection: () => string,
): () => void {
  const onCopy = (event: ClipboardEvent): void => {
    const selection = getSelection();
    if (!selection) return;
    event.preventDefault();
    if (event.clipboardData) event.clipboardData.setData('text/plain', selection);
    else void copyToClipboard(selection);
  };
  container.addEventListener('copy', onCopy);
  return () => container.removeEventListener('copy', onCopy);
}

/**
 * `Ctrl+Shift+C` / `Ctrl+Shift+V`, the Windows and Linux terminal chords.
 *
 * Capture phase on the container, because ghostty-web's `keydown` listener is
 * a bubble listener on the same element: a `Ctrl+Shift+C` that reached it would
 * be encoded for the PTY, not copied.
 */
export function installTerminalCopyChords(
  container: HTMLElement,
  actions: { getSelection: () => string; paste: (text: string) => void },
): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!event.ctrlKey || !event.shiftKey || event.altKey) return;
    if (event.code === 'KeyC') {
      const selection = actions.getSelection();
      if (!selection) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void copyToClipboard(selection);
      return;
    }
    if (event.code === 'KeyV') {
      event.preventDefault();
      event.stopImmediatePropagation();
      void readClipboardText().then((text) => {
        if (text) actions.paste(text);
      });
    }
  };
  container.addEventListener('keydown', onKeyDown, true);
  return () => container.removeEventListener('keydown', onKeyDown, true);
}
