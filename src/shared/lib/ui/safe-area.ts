/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The padding a fixed overlay keeps clear of a phone's own chrome.
 *
 * A `fixed inset-0` frame reaches the viewport's physical edges, and on a
 * `viewport-fit: cover` surface those edges run UNDER the status bar and the
 * home indicator. Every dialog in this console states the same four declarations
 * inline (the shared `Modal` shell, the About card, …); stated twice, one of them
 * eventually forgets, and the symptom is a header nobody can tap.
 *
 * `env()` is 0 on a desktop, so a single rule serves both surfaces — no
 * media query, and no second copy for the desktop.
 */

/** The gutter a dialog keeps from every edge when no safe area applies. */
export const DIALOG_GUTTER_REM = 0.75;

export type SafeAreaPadding = {
  paddingTop: string;
  paddingBottom: string;
  paddingLeft: string;
  paddingRight: string;
};

/**
 * @param gutterRem the edge gutter used when `env()` reports no inset.
 *   `max()`, not a sum: on a notched device the safe area is the LARGER of the
 *   two, and adding them would inset a dialog twice as far as the device needs.
 */
export function safeAreaPadding(gutterRem: number = DIALOG_GUTTER_REM): SafeAreaPadding {
  const gutter = `${gutterRem}rem`;
  return {
    paddingTop: `max(${gutter}, env(safe-area-inset-top, 0px))`,
    paddingBottom: `max(${gutter}, env(safe-area-inset-bottom, 0px))`,
    paddingLeft: `max(${gutter}, env(safe-area-inset-left, 0px))`,
    paddingRight: `max(${gutter}, env(safe-area-inset-right, 0px))`,
  };
}
