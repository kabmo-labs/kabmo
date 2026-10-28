/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The color Chrome paints behind an installed app's title bar.
 *
 * `<meta name="theme-color">` styles the window chrome of an installed PWA (and
 * the status bar on a phone), and it has to be the color the layout paints
 * across the TOP of the window or the two meet in a visible seam. That color is
 * not one palette slot: the desktop layout's top strip is `bg-paper`
 * (`desktop-layout/TopNavbar.tsx`, with the sidebar's own `bg-paper` beside
 * it), while the phone's header is `bg-canvas`
 * (`mobile/mobile-main-view/Header.tsx`) and the login screen is `bg-canvas`
 * too (`auth/login-screen`).
 *
 * The rule lives here, in one function, because it has two writers — the SSR
 * shell (which knows the user agent and whether the request was authenticated)
 * and the client theme writer (which knows the layout the user ended up in) —
 * and a rule restated at a call site is a rule that drifts. Writing
 * `palette.canvas` unconditionally is what shipped: every desktop install drew
 * a chrome strip one step darker than the header beneath it (`#f4f1ea` over
 * `#faf8f3` on the default palette, `#21252b` over `#282c34` on
 * `one-dark-pro-soft`).
 */

import type { ThemePalette } from '@/shared/types/theme';

/** The two facts the chrome color depends on, as each writer knows them. */
export interface WindowChromeMode {
  /** The phone layout is on screen, whose header is `--theme-canvas`. */
  isMobile: boolean;
  /** The login screen is on screen — `--theme-canvas` in both layouts. */
  authRequired: boolean;
}

/** The palette slot the window chrome is painted with. */
export function windowChromeColor(palette: ThemePalette, mode: WindowChromeMode): string {
  return mode.authRequired || mode.isMobile ? palette.canvas : palette.paper;
}
