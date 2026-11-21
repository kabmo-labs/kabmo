/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The ONE shape of a phone chrome row: the height, the notch and the window
 * insets.
 *
 * Every full-screen phone surface is a title bar — the chat header, the two
 * drawers, the model picker, the editor and the diff. Each of them used to state
 * its own four declarations, and they had already drifted: the chat header and
 * both drawers were `3.5rem`, while the editor and the diff were `3rem`, so
 * opening a file moved the back control 8px up and made the row read as a
 * different window. The model picker was a third case — a 36px strip holding a
 * 28px close button, under a 49px tab strip, i.e. two rows where every other
 * surface has one.
 *
 * The inset is `titlebarInsetLeft(titlebarPaddingLeft(...))`, not
 * `titlebarPaddingLeft` alone: a native shell that does not report the PWA's
 * `titlebar-area-x` (a WKWebView) draws its traffic lights over the page, and
 * the resolved padding then sits UNDER them. `titlebarInsetLeft` is the shell's
 * own report, which is what the desktop navbar and the session drawer already
 * use — and a desktop shell window narrowed past the layout breakpoint renders
 * this phone chrome, so it needs the same answer.
 *
 * The safe area is height AND padding because `box-sizing` is border-box
 * globally: height alone pins the content to y=0 (controls under the status
 * bar), padding alone is eaten out of the row.
 */

import type { CSSProperties } from 'preact/compat';
import { titlebarPaddingLeft, titlebarPaddingRight } from '@/shared/lib/ui/titlebar';
import { titlebarInsetLeft } from '@/client/lib/desktop/titlebar';

/** The row's height, notch included. */
export const PHONE_ROW_HEIGHT = 'calc(3.5rem + env(safe-area-inset-top, 0px))';

/**
 * The full set of declarations a phone title bar carries.
 *
 * @param base the horizontal inset when no safe area and no shell applies.
 *   `0.75rem` is the app header's own `px-3`, so a surface that draws a control
 *   at the row's edge lines up with the hamburger above the chat.
 */
export function phoneRowStyle(base = '0.75rem'): CSSProperties {
  return {
    height: PHONE_ROW_HEIGHT,
    paddingTop: 'env(safe-area-inset-top, 0px)',
    paddingLeft: titlebarInsetLeft(titlebarPaddingLeft(base, true)),
    paddingRight: titlebarPaddingRight(base, true),
  };
}

/**
 * The same insets WITHOUT a height, for a full-screen frame that owns the whole
 * viewport (`h-dvh`).
 *
 * A full-screen surface is not a row: giving it `PHONE_ROW_HEIGHT` would make
 * the dialog 56px tall. What it does need is the notch and the shell's insets,
 * because its FIRST row is the title bar — the model picker's harness strip, the
 * editor's file row — and that row's controls would otherwise sit under the
 * status bar and under a macOS window's traffic lights.
 */
export function phoneFrameStyle(base = '0.75rem'): CSSProperties {
  return {
    paddingTop: 'env(safe-area-inset-top, 0px)',
    paddingLeft: titlebarInsetLeft(titlebarPaddingLeft(base, true)),
    paddingRight: titlebarPaddingRight(base, true),
  };
}
