/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two Shiki palettes every token carries.
 *
 * Shiki emits both palettes on every token span as `--shiki-light` /
 * `--shiki-dark` custom properties with no inline color, so switching themes
 * recolors code with zero JS and no re-highlight. `tailwind.css` selects which
 * one paints, keyed off `<html data-theme-variant>` rather than a list of theme
 * ids — that list is what a new theme used to fall through.
 */
export const SHIKI_LIGHT = 'one-light';
export const SHIKI_DARK = 'one-dark-pro';

export const SHIKI_THEMES = { light: SHIKI_LIGHT, dark: SHIKI_DARK } as const;
