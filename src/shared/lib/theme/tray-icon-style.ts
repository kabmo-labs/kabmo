/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * How the MENU-BAR / NOTIFICATION-AREA icon is painted, as one of two styles.
 *
 * This is deliberately a separate setting from `iconStyle` (`./icon-style.ts`):
 * the tray is a SYSTEM surface, not an in-app one. A user can want full-colour
 * marks inside the console and a monochrome glyph in the menu bar — that is the
 * macOS convention, and it is also what keeps a coloured square from sitting
 * beside the system's own monochrome status items.
 *
 *  - `color`      — the shipped app icon, plate and all. The default, so an
 *    upgrade changes nothing.
 *  - `monochrome` — a greyscale conversion of the app icon: the green plate
 *    and the cream strokes swap luminance with the theme, and the orange arm
 *    becomes the middle grey.
 *
 * The value is stored in the `kabmo_settings` blob and read by the SERVER when
 * it writes the tray config, because the tray host is a separate process that
 * never sees the page.
 */

export type TrayIconStyle = 'color' | 'monochrome';

/** The style a fresh install — or any stored value this build cannot draw — resolves to. */
export const DEFAULT_TRAY_ICON_STYLE: TrayIconStyle = 'color';

/** `app_settings` key holding the style. */
export const TRAY_ICON_STYLE_SETTING_KEY = 'trayIconStyle';

/** Every style, in the order the settings control lists them. */
export const TRAY_ICON_STYLES = ['color', 'monochrome'] as const;

/** A stored value written by another build is not a style this one can draw. */
export function isTrayIconStyle(value: unknown): value is TrayIconStyle {
  return value === 'color' || value === 'monochrome';
}

/**
 * The style to APPLY for a stored value. Anything this build cannot draw
 * resolves to the default, so a corrupted blob cannot leave the tray with no
 * icon at all.
 */
export function resolveTrayIconStyle(value: unknown): TrayIconStyle {
  return isTrayIconStyle(value) ? value : DEFAULT_TRAY_ICON_STYLE;
}

export interface TrayIconStyleCopy {
  label: string;
  /** The tradeoff, stated once — including what the mode cannot colour. */
  description: string;
  caption: string;
}

export const TRAY_ICON_STYLE_COPY: Record<TrayIconStyle, TrayIconStyleCopy> = {
  color: {
    label: 'Full colour',
    description: 'The shipped app icon, plate and all. Matches the icon in the Dock, the taskbar and the launcher.',
    caption: 'App icon',
  },
  monochrome: {
    label: 'Monochrome',
    description: 'A greyscale conversion of the app icon: the green plate and the cream strokes swap luminance with the theme, and the orange arm becomes the middle grey.',
    caption: 'Greyscale',
  },
};
