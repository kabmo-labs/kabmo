/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * How EVERY icon is painted, as ONE of two styles.
 *
 * Three families of icon ship in this app and this setting covers all three:
 *
 * 1. **Functional glyphs** — Lucide's stroke icons (247 imports, 346 files).
 *    There is no second artwork to swap in, so `color` can only mean a TINT.
 *    Each glyph gets its own hue from a generated table (`icons/tint.ts`), except
 *    the ones whose meaning IS a signal (a trash can, a check, a clock, an info
 *    dot), which take the palette's `--theme-error` / `-success` / `-warning` /
 *    `-info`.
 * 2. **Provider and model marks** (`provider-icon/`) — brand logos, painted in
 *    the brand's own colour where it publishes one.
 * 3. **File-type marks** (`file-icon/`) — the language and tool logos a file
 *    list is read by.
 *
 *  - `monochrome` — every icon in the surrounding ink. The DEFAULT, because it
 *    is what Kabmo ships today: an upgrade must not repaint a window the user
 *    did not ask to change.
 *  - `color`      — each icon in its own colour. A brand colour that would
 *    vanish on the active variant (a black logo on a dark theme) keeps the ink
 *    instead, and the generated hues are stated at a lightness that clears the
 *    3:1 non-text floor on every palette of that variant, so this never trades a
 *    legible row for a literal hex.
 *
 * Every rule is `:where()`-wrapped, so this is a DEFAULT paint and never an
 * override: a caller's own `text-error` on a missing file, or `text-ink/40` on a
 * muted row, still wins. That is what makes one global switch safe over 346
 * files that never agreed to it.
 *
 * The style reaches the document as `data-icon-style` on `<html>`, read by CSS
 * only: `ProviderIconPlate` alone is drawn in 26 places across five surfaces,
 * and a prop would be 26 chances to miss one.
 */

export type IconStyle = 'monochrome' | 'color';

/**
 * The style a document with no stored preference renders at. Every provider
 * mark was ink before this setting existed, so this is the no-change default.
 */
export const DEFAULT_ICON_STYLE: IconStyle = 'monochrome';

/** Document attribute carrying the style. Read by CSS only. */
export const ICON_STYLE_ATTRIBUTE = 'data-icon-style';

/** `app_settings` key holding the style — see `SURFACE_STYLE_SETTING_KEY`. */
export const ICON_STYLE_SETTING_KEY = 'iconStyle';

/** Every style, in the order the settings control lists them. */
export const ICON_STYLES = ['monochrome', 'color'] as const;

/** A stored value written by another build is not a style this one can draw. */
export function isIconStyle(value: unknown): value is IconStyle {
  return value === 'monochrome' || value === 'color';
}

/**
 * The style to APPLY for a stored value. Anything this build cannot draw
 * resolves to the default, so a corrupted blob cannot leave every mark
 * unpainted.
 */
export function resolveIconStyle(value: unknown): IconStyle {
  return isIconStyle(value) ? value : DEFAULT_ICON_STYLE;
}

export interface IconStyleCopy {
  label: string;
  /** The tradeoff, stated once — including what the mode cannot colour. */
  description: string;
  caption: string;
}

export const ICON_STYLE_COPY: Record<IconStyle, IconStyleCopy> = {
  monochrome: {
    label: 'Monochrome',
    description: 'Every icon inherits the palette ink — toolbar glyphs, provider logos and file marks alike. The most uniform reading.',
    caption: 'Palette ink',
  },
  color: {
    label: 'Full colour',
    description: 'Each icon gets its own colour: glyphs a per-icon hue, brand marks their own logo colour, a project its accent. Tool cards in a transcript stay ink — they are read, not scanned.',
    caption: 'Per-icon colour',
  },
};
