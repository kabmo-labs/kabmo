/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Where a phone's header overlays hang, in ONE place.
 *
 * Both the session picker (`MobileHeader`) and the server panel hang below the
 * 3.5rem title bar, and both used to state the same six numbers inline. They
 * drifted once already: the server panel was drawn `absolute` at 340px, which
 * on a 390px phone runs off the right edge and past the bottom in landscape.
 *
 * Pinned to the VIEWPORT with both insets rather than anchored to the trigger:
 * a trigger is not always near the edge it would have to grow from, and the
 * safe area is a property of the device, not of the button.
 *
 * `100dvh`, not `100vh`: a landscape phone's visible height is the dynamic one,
 * and a `vh` cap left the last rows under the browser's own chrome.
 */

/** The title bar both phone headers draw. */
export const MOBILE_HEADER_REM = 3.5;

/** The gap between that bar and the overlay. */
const GAP_REM = 0.375;

/** The inset kept from the screen's left and right edges. */
const INSET_REM = 0.75;

/**
 * A type alias rather than an interface: preact's `CSSProperties` carries an
 * index signature, and an interface has no implicit one, so the object below is
 * not assignable to a `style` prop otherwise.
 */
export type MobileOverlayStyle = {
  top: string;
  left: string;
  right: string;
  maxWidth: string;
  maxHeight: string;
  overflowY: 'auto';
};

/**
 * The style for an overlay hanging below the phone's title bar.
 *
 * `maxWidth` keeps a wide phone from stretching a menu across the screen; the
 * `maxHeight` subtracts the bar, the gap and the safe area, so a landscape
 * phone scrolls the overlay instead of running it past the bottom edge.
 */
export function mobileOverlayStyle(maxWidthRem = 18): MobileOverlayStyle {
  return {
    top: `calc(${MOBILE_HEADER_REM}rem + env(safe-area-inset-top, 0px) + ${GAP_REM}rem)`,
    left: `max(${INSET_REM}rem, env(safe-area-inset-left, 0px))`,
    right: `max(${INSET_REM}rem, env(safe-area-inset-right, 0px))`,
    maxWidth: `${maxWidthRem}rem`,
    maxHeight: `calc(100dvh - ${MOBILE_HEADER_REM}rem - env(safe-area-inset-top, 0px) - ${GAP_REM + INSET_REM}rem)`,
    overflowY: 'auto',
  };
}
