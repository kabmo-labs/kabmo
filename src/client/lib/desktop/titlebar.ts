/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Making the page's own header act as the desktop window's title bar.
 *
 * Three facts, and the third is why this module is shared by three shells.
 *
 * 1. **The window controls float OVER the content**, because the window is
 *    built with a transparent title bar over a full-size content view. WHICH
 *    EDGE they occupy is the platform's choice, and getting it wrong is a dead
 *    strip of window with no control in it: macOS puts its traffic lights on
 *    the LEFT, so the leftmost ~76px of the page is behind them and a wordmark
 *    drawn at the normal 16px inset sits under the close button.
 *
 *    - Windows is borderless too, but draws nothing over the page: its webview
 *      is an HWND, so a host element cannot be painted on top of it. The page
 *      draws its own minimise / maximise / close instead (`windowControls`), so
 *      the only edge it reserves anything for is the one macOS owns. Linux is
 *      the same: borderless, page-drawn controls, no reserved edge.
 *
 *    The inset is therefore REPORTED by the shell (`trafficLightInset`), and a
 *    shell that reports none gets the caller's own resolved padding.
 *
 * 2. **The drag region is decided by the SHELL, from a selector** — not by CSS.
 *    macOS asks the page whether the press landed on `[data-drag-region]`
 *    (`ShellWindow.sendEvent`); Windows lets WebView2 do the same with
 *    `IsNonClientRegionSupportEnabled`, which is what makes `app-region: drag`
 *    mean the title bar there. The page's only job is to MARK its header.
 *
 * 3. **The inset must survive a page that has not asked yet.** The shells inject
 *    their identity before the first script runs, so the first paint is already
 *    correct; a shell that did not (an older build) leaves this module with no
 *    identity, and the answer is the caller's own padding rather than a guess.
 */

import { isDesktopShell } from '@/client/lib/desktop/bridge';

/** Width macOS reserves for its traffic lights, plus the gap after them. */
export const TRAFFIC_LIGHT_INSET = '5rem';

/** The shell's own report, or null in a browser (and in an older shell). */
function shellInfo(): { overlayTitlebar: boolean; trafficLightInset?: string; windowControls?: boolean } | null {
  if (typeof window === 'undefined') return null;
  const injected = window.__kabmoDesktop;
  return injected ?? null;
}

/** True when the shell hid the native title bar and the page draws it. */
export function overlayTitlebar(): boolean {
  if (!isDesktopShell()) return false;
  // The injected identity is authoritative when present: a shell that reports
  // `overlayTitlebar: false` draws its own native bar and the page must not
  // reserve anything for controls it does not have.
  const injected = shellInfo();
  return injected ? injected.overlayTitlebar : true;
}

/**
 * The attribute that marks an element as a window drag handle.
 *
 * `data-drag-region` is read by the macOS shell's own hit test. It is an
 * ATTRIBUTE rather than a class so it cannot be reordered away by a utility
 * class and does not read as styling.
 */
export function dragRegionProps(): Record<string, string> {
  return overlayTitlebar() ? { 'data-drag-region': '' } : {};
}

/**
 * The left inset the first header on the strip must carry.
 *
 * macOS: the traffic lights' width — the caller's own padding would be *inside*
 * them. Windows and Linux: the caller's own padding, because the caption
 * buttons are on the other edge (or drawn by the page) and reserving here would
 * leave a hole. Everywhere else it is what the caller already resolved, which is
 * the PWA's Window Controls Overlay arithmetic (`titlebar-area-x`).
 */
export function titlebarInsetLeft(resolved: string): string {
  if (!overlayTitlebar()) return resolved;
  return shellInfo()?.trafficLightInset ?? resolved;
}

/**
 * True when the page must draw the window's own controls.
 *
 * The Windows and Linux shells answer true: both are borderless, and Windows'
 * webview is an HWND that no host element can be drawn over, so the three
 * buttons the macOS shell gets from the system have to come from the page there.
 * Linux COULD draw them (`GtkOverlay` children do receive clicks over a WebView,
 * measured), but the page's set already exists and is tested.
 */
export function drawsWindowControls(): boolean {
  return overlayTitlebar() && shellInfo()?.windowControls === true;
}
