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
}

/**
 * Apply the stored style before the first render, and make sure the generated
 * icon-paint stylesheet is in the document.
 *
 * The stylesheet is written by the server shell (it is generated from a TS
 * table, so the bundler cannot carry it — the same split `themeStyleSheet` uses).
 * This only repairs a document served by a build that predates it; without the
 * repair, `color` mode would set the attribute and paint nothing.
 */
export function initIconStyle(): void {
  if (typeof document !== 'undefined' && !document.getElementById(ICON_PAINT_STYLE_ELEMENT_ID)) {
    const style = document.createElement('style');
    style.id = ICON_PAINT_STYLE_ELEMENT_ID;
    style.textContent = iconPaintStyleSheet();
    document.head.appendChild(style);
  }
  applyIconStyle(readKabmoSetting<unknown>(ICON_STYLE_SETTING_KEY));
}
