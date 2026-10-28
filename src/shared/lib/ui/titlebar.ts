/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The insets that keep a header's controls clear of the PWA window controls
 * (Window Controls Overlay), stated ONCE because four headers draw them.
 *
 * The `titlebar-area-*` env variables describe the area the page may use: it
 * runs from the frame edge to the innermost edge of the overlay that houses the
 * window controls. Which SIDE that overlay is on is the platform's choice, and
 * `titlebar-area-x` is the answer:
 *
 *   - macOS puts the traffic lights on the LEFT, so `x` is ~76px and
 *     `titlebar-area-width` is `viewport - 76`;
 *   - Windows and Linux put the controls (and Chrome's `⋮` app menu) on the
 *     RIGHT, so `x` is `0` and `titlebar-area-width` is `viewport - overlay`.
 *
 * So the LEFT inset is `x`, and the RIGHT inset is whatever is left over after
 * the area ENDS — `viewport - (x + width)` — never `viewport - width`. The
 * second form is what the headers used to compute, and on macOS it reserved the
 * traffic lights' width on the wrong edge: a 76px dead strip between the last
 * navbar control and the window's right edge, with no control anywhere near it.
 * On Windows the two forms agree, which is why the bug only showed on one
 * platform.
 *
 * `safeArea` adds the iOS/Android notch insets, which the phone headers carry.
 * A desktop PWA has them at 0, so one helper serves both.
 */

/**
 * The width of the overlay that sits to the RIGHT of the title bar area.
 *
 * Both env variables are read with a fallback, so this is `0px` in a browser
 * tab (where WCO is not active) and on macOS, and the platform's real control
 * width on Windows/Linux.
 */
export const TITLEBAR_OVERLAY_RIGHT =
  'calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw))';

/** `base`-sized padding that also clears the window controls on the left. */
export function titlebarPaddingLeft(base: string, safeArea = false): string {
  return safeArea
    ? `max(${base}, env(safe-area-inset-left, 0px), env(titlebar-area-x, 0px))`
    : `max(${base}, env(titlebar-area-x, 0px))`;
}

/** `base`-sized padding that also clears the window controls on the right. */
export function titlebarPaddingRight(base: string, safeArea = false): string {
  return safeArea
    ? `max(${base}, env(safe-area-inset-right, 0px), ${TITLEBAR_OVERLAY_RIGHT})`
    : `max(${base}, ${TITLEBAR_OVERLAY_RIGHT})`;
}
