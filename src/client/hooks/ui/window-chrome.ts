/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The client's writer for the PWA window chrome. `shared/lib/theme/chrome.ts`
 * owns WHY the color is not simply the canvas.
 *
 * Two writers hand out that meta tag and they have to agree: the SSR shell
 * writes it into the served document, and this module re-writes it whenever a
 * fact behind it moves — the palette (a settings change) or the surface (the
 * layout mode, a manual layout switch, the login screen). The server's own two
 * facts (user agent, authentication) are baked into the document, so `main.tsx`
 * seeds this module from the bootstrap BEFORE the first theme write; without
 * that seed a phone repaints the tag with the desktop's color for a frame.
 */

import { DEFAULT_THEME_ID, resolveTheme } from '@/shared/lib/theme/catalog';
import { windowChromeColor } from '@/shared/lib/theme/chrome';

/** The palette last applied to the document. */
let themeId: string = DEFAULT_THEME_ID;
/** The layout on screen; `App` keeps this in step. */
let isMobile = false;
/** Whether the login screen is up; `App` keeps this in step. */
let authRequired = false;

function write(): void {
  if (typeof document === 'undefined') return;
  const content = windowChromeColor(resolveTheme(themeId), { isMobile, authRequired });
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', content);
}

/**
 * Seed the two surface facts from the server-rendered bootstrap, before the
 * first theme write. Deliberately does not write: the shell already carries the
 * server's own verdict, and `initDocumentTheme()` repaints immediately after.
 */
export function primeWindowChrome(mode: { isMobile: boolean; authRequired: boolean }): void {
  isMobile = mode.isMobile;
  authRequired = mode.authRequired;
}

/** Point the chrome at `id`'s palette and repaint — the theme writer's half. */
export function applyWindowChrome(id: string): void {
  themeId = id;
  write();
}

/** Report the layout on screen. Repaints only when the color actually moves. */
export function setWindowChromeLayout(next: boolean): void {
  if (isMobile === next) return;
  isMobile = next;
  write();
}

/** Report whether the login screen is up. Repaints only when it moves. */
export function setWindowChromeAuthRequired(next: boolean): void {
  if (authRequired === next) return;
  authRequired = next;
  write();
}
