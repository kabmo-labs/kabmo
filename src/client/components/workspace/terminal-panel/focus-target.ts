/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which element takes the terminal's focus, per device.
 *
 * ghostty-web focuses its CONTAINER (`tabindex=0`, `contenteditable`), which is
 * the hardware-keyboard surface: its `keydown` listener is what encodes a
 * physical key. A phone's input arrives as `beforeinput` on the renderer's
 * textarea instead, and only an editable element that is focused can open the
 * soft keyboard — focusing the container there left the keyboard closed and the
 * panel needing a tap before it accepted a character.
 *
 * The second half is a race the vendor creates: `Terminal.open()` ends with
 * `focus()`, and `Terminal.focus()` focuses the container and then focuses it
 * AGAIN on a 0 ms timer. Focusing the textarea after `open()` therefore lost to
 * that timer one tick later — measured on the phone layout: the textarea held
 * focus at mount and the container owned it 12 ms after. A `focusin` redirect is
 * event-driven, so it survives the timer and any later internal `focus()`;
 * keydown still reaches the container because the textarea is its child.
 */

import type { Terminal } from 'ghostty-web';
import { isSoftKeyboardDevice } from '@/client/hooks/ui/touch-device';

/** Focus whatever this device types into. */
export function focusTerminal(term: Terminal): void {
  if (isSoftKeyboardDevice() && term.textarea) term.textarea.focus();
  else term.focus();
}

/**
 * Move the textarea's keyboard focus onto the terminal on a phone.
 *
 * A no-op on a desktop, where the container is the correct target and the
 * padding click's caret behaviour is pinned by `terminal.e2e.ts`.
 */
export function focusTerminalTextarea(term: Terminal): void {
  if (isSoftKeyboardDevice()) term.textarea?.focus();
}

/**
 * Keep a soft-keyboard device's focus on the textarea. Returns the disposer.
 */
export function redirectSoftKeyboardFocus(container: HTMLElement, term: Terminal): () => void {
  const redirect = (event: FocusEvent) => {
    if (event.target !== container || !isSoftKeyboardDevice()) return;
    term.textarea?.focus();
  };
  container.addEventListener('focusin', redirect);
  return () => container.removeEventListener('focusin', redirect);
}
