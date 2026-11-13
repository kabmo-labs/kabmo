/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The single writer for the brand-mark paint style.
 *
 * Same contract as `surface-style.ts`: an attribute on `<html>`, read by CSS
 * only, because `ProviderIconPlate` is drawn in 26 places across five surfaces
 * and a prop would be 26 chances to miss one. The rules live in
 * `src/client/tailwind.css` (`[data-icon-style]`) and read the brand table in
 * `provider-icon/brand-colors.ts` — never a colour written at a call site.
 */

import { readKabmoSetting } from '@/shared/lib/settings/client';
import {
  DEFAULT_ICON_STYLE,
  ICON_STYLE_ATTRIBUTE,
  ICON_STYLE_SETTING_KEY,
  resolveIconStyle,
} from '@/shared/lib/theme/icon-style';
import {
  ICON_PAINT_STYLE_ELEMENT_ID,
  iconPaintStyleSheet,
} from '@/shared/lib/icons/icon-paint-css';
import { THEME_CSS_LINK_ATTRIBUTE } from '@/shared/lib/theme/css';
import { ICON_PAPER_ATTRIBUTE } from '@/shared/lib/icons/tint';
import { paperBucketOf } from '@/shared/lib/icons/icon-tone';
import { resolveTheme } from '@/shared/lib/theme/catalog';

/**
 * Point the document at the paper bucket of the palette it is painting.
 *
 * One `ICON_TONES` table had to clear the floor on the DARKEST light paper in
 * the catalog, so a palette with a brighter paper painted every icon at
 * lightness it did not need: measured on the default palette, mean L 0.582 where
 * that paper allows 0.640, against dark's 0.782 — the reported "light mode
 * kusam". The bucket is an ATTRIBUTE rather than a resolved colour so a theme
 * switch only moves one attribute instead of re-stamping every mark on screen.
 */
export function applyIconPaper(theme?: string): void {
  if (typeof document === 'undefined') return;
  // The palette id is read from the document rather than from `theme.ts`, whose
  // `applyDocumentTheme` is what CALLS this: importing its `currentThemeId`
  // would close a module cycle and leave the export undefined at load.
  const id = theme ?? document.documentElement.dataset.theme ?? '';
  const palette = resolveTheme(id);
  const root = document.documentElement;
  if (palette.variant === 'dark') root.removeAttribute(ICON_PAPER_ATTRIBUTE);
  else root.setAttribute(ICON_PAPER_ATTRIBUTE, paperBucketOf(palette.paper));
}

/**
 * Point the document at `style`.
 *
 * The default is REMOVED rather than written, so the ink rule in CSS is the
 * single statement of what "no attribute" means.
 */
export function applyIconStyle(style: unknown): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const resolved = resolveIconStyle(style);
  if (resolved === DEFAULT_ICON_STYLE) root.removeAttribute(ICON_STYLE_ATTRIBUTE);
  else root.setAttribute(ICON_STYLE_ATTRIBUTE, resolved);
  // The bucket belongs to the same writer: a document that states one style
  // without the other paints a `mid` palette with the `deep` table.
  applyIconPaper();
}

/**
 * Apply the stored style before the first render, and make sure the generated
 * icon-paint stylesheet is in the document.
 *
 * The stylesheet is served by the server shell as part of a content-hashed
 * `<link>` (it is generated from a TS table, so the bundler cannot carry it —
 * the same split `themeStyleSheet` uses). This only repairs a document served by
 * a build that predates that link; without the repair, `color` mode would set
 * the attribute and paint nothing.
 */
export function initIconStyle(): void {
  // The shell serves this sheet as part of a linked, content-hashed stylesheet;
  // the inline copy is only the repair for a document that predates the link.
  const linked = typeof document !== 'undefined' && document.querySelector(`link[${THEME_CSS_LINK_ATTRIBUTE}]`) !== null;
  if (typeof document !== 'undefined' && !linked && !document.getElementById(ICON_PAINT_STYLE_ELEMENT_ID)) {
    const style = document.createElement('style');
    style.id = ICON_PAINT_STYLE_ELEMENT_ID;
    style.textContent = iconPaintStyleSheet();
    document.head.appendChild(style);
  }
  applyIconStyle(readKabmoSetting<unknown>(ICON_STYLE_SETTING_KEY));
}
