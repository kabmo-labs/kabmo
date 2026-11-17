/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The terminal is the one built-in panel that is typed into, so it is the one
 * that needs the soft keyboard open before its view mounts.
 *
 * The phone shell arms it at the moment of the tap, before the view exists; the
 * drawer releases the bridge (`lib/ui/soft-keyboard.ts`) when the panel it
 * actually resolved is not the terminal — a stored tab the user has since
 * disabled or moved, or a session with no workspace, must not leave the keyboard
 * up over another view.
 */

import { openSoftKeyboard } from '@/client/lib/ui/soft-keyboard';

/** The built-in id of this panel (`RIGHT_PANEL_TYPES`), spelled once here. */
const TERMINAL_PANEL_ID = 'terminal';

export function panelWantsSoftKeyboard(panelKey: string | null | undefined): boolean {
  return panelKey === TERMINAL_PANEL_ID;
}

/** Arm the keyboard for the panel about to open; a no-op for every other view. */
export function armTerminalSoftKeyboard(panelKey: string | null | undefined): void {
  if (panelWantsSoftKeyboard(panelKey)) openSoftKeyboard();
}
