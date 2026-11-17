/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Summon the soft keyboard from inside a tap.
 *
 * A phone opens its keyboard only while a user gesture is active. The terminal
 * panel asks for focus the moment it becomes visible, but the element that takes
 * focus is created by `mountTerminal`, whose ghostty-web import and font wait
 * resolve long after the tap that opened the panel has ended — so the focus
 * landed, the keyboard did not, and the first command needed a tap on the canvas
 * first.
 *
 * `openSoftKeyboard()` focuses a 1px offscreen textarea synchronously in that
 * tap. When the terminal mounts it takes focus from the bridge, and the keyboard
 * stays up because focus moved between two editable elements. The bridge is not
 * an input: it is cleared on every arm, and the terminal's own textarea is the
 * surface that receives the keystrokes.
 *
 * The element is deliberately NOT `display:none`/`visibility:hidden` — a hidden
 * element cannot take focus — and its font size is 16px, the size below which
 * iOS zooms the page on focus.
 */

import { isSoftKeyboardDevice } from '@/client/hooks/ui/touch-device';

/** Marks the bridge for the tests; it is not a product hook. */
export const SOFT_KEYBOARD_BRIDGE_ATTR = 'data-soft-keyboard-bridge';

/**
 * How long the bridge may hold the keyboard with no terminal to hand it to.
 *
 * The terminal's mount is bounded by the font wait (2s) plus the import, so a
 * bridge that is still focused after this long belongs to a panel that never
 * opened (no workspace, a disabled view) and must not leave the keyboard up.
 */
const RELEASE_AFTER_MS = 8000;

let bridge: HTMLTextAreaElement | null = null;
let releaseTimer: ReturnType<typeof setTimeout> | undefined;

function createBridge(): HTMLTextAreaElement {
  const element = document.createElement('textarea');
  element.tabIndex = -1;
  element.autocomplete = 'off';
  element.setAttribute('autocorrect', 'off');
  element.setAttribute('autocapitalize', 'off');
  element.setAttribute('spellcheck', 'false');
  element.setAttribute('aria-label', 'Terminal keyboard');
  element.setAttribute(SOFT_KEYBOARD_BRIDGE_ATTR, '');
  element.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'width:1px',
    'height:1px',
    'padding:0',
    'border:0',
    'margin:0',
    'opacity:0',
    'font-size:16px',
    'pointer-events:none',
    'z-index:-1',
  ].join(';');
  document.body.appendChild(element);
  return element;
}

/** Focus the bridge now, while the caller's tap is still a user gesture. */
export function openSoftKeyboard(): void {
  if (typeof document === 'undefined' || !isSoftKeyboardDevice()) return;
  if (!bridge || !bridge.isConnected) bridge = createBridge();
  clearTimeout(releaseTimer);
  bridge.value = '';
  bridge.focus({ preventScroll: true });
  releaseTimer = setTimeout(releaseSoftKeyboard, RELEASE_AFTER_MS);
}

/**
 * Drop the bridge's keyboard, but never steal focus from whatever holds it now.
 *
 * Called when the panel that asked for the keyboard turns out not to be the
 * terminal, and by the terminal panel when it is not the visible view.
 */
export function releaseSoftKeyboard(): void {
  clearTimeout(releaseTimer);
  if (bridge && document.activeElement === bridge) bridge.blur();
}
