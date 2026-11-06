/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `<html>` attributes of the served shell, written in one place.
 *
 * `index.html` is a static template that every request rewrites, and the
 * attributes it carries are the FIRST FRAME's whole appearance: the palette, the
 * surface material and the brand-mark paint. A second replacement pass for the
 * two new attributes was one `String.replace` away from silently missing — a
 * missing attribute is not an error, it is the default look — so all four are
 * stated together, in a function a test can call without rendering the shell.
 *
 * Two properties are load-bearing:
 *
 * - **`data-theme` and `data-theme-variant` are ALWAYS written.** They are the
 *   palette; `applyDocumentTheme` owns them after hydration, and a document
 *   served without them keeps `:root`'s shipped palette.
 * - **The two style attributes are written only when they are not the default.**
 *   `applySurfaceStyle` / `applyIconStyle` remove the attribute for the default,
 *   so emitting `data-surface="classic"` here would make the server and the
 *   client disagree about the document's own state — and every CSS rule keys on
 *   the value, not on its absence.
 */

import type { ThemePalette } from '@/shared/types/theme';
import {
  DEFAULT_ICON_STYLE,
  ICON_STYLE_ATTRIBUTE,
  resolveIconStyle,
} from '@/shared/lib/theme/icon-style';
import { ICON_PAPER_ATTRIBUTE } from '@/shared/lib/icons/tint';
import { paperBucketOf } from '@/shared/lib/icons/icon-tone';
import {
  DEFAULT_SURFACE_STYLE,
  SURFACE_ATTRIBUTE,
  resolveSurfaceStyle,
} from '@/shared/lib/theme/surface-style';

export interface ShellDocumentFacts {
  palette: ThemePalette;
  /** The stored surface style, unresolved — any value this build cannot draw
   *  falls to the default rather than to an attribute no rule matches. */
  surfaceStyle: unknown;
  iconStyle: unknown;
  /** The `<meta name="theme-color">` value for this request. */
  chromeColor: string;
}

/** The template's own values, which the replacements below look for. */
const TEMPLATE_THEME = 'data-theme="paper"';
const TEMPLATE_VARIANT = 'data-theme-variant="light"';
const TEMPLATE_META = '<meta name="theme-color" content="#faf8f3" />';

/** The extra `<html>` attributes for the stored presentation styles. */
export function styleAttributes(surfaceStyle: unknown, iconStyle: unknown, palette?: ThemePalette): string {
  const surface = resolveSurfaceStyle(surfaceStyle);
  const icon = resolveIconStyle(iconStyle);
  const parts: string[] = [];
  if (surface !== DEFAULT_SURFACE_STYLE) parts.push(`${SURFACE_ATTRIBUTE}="${surface}"`);
  if (icon !== DEFAULT_ICON_STYLE) parts.push(`${ICON_STYLE_ATTRIBUTE}="${icon}"`);
  // The paper bucket is written for EVERY light palette, including the default
  // one, because it is not a preference: without it the first frame paints the
  // `deep` icon table on a `mid` paper — one step darker than the palette allows,
  // which is the exact flash the client's `applyIconPaper` then corrects.
  if (palette && palette.variant === 'light') parts.push(`${ICON_PAPER_ATTRIBUTE}="${paperBucketOf(palette.paper)}"`);
  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

/**
 * Rewrite the template's palette and chrome placeholders for one request.
 *
 * Returns the html unchanged for a document that predates the markers — the
 * client's `initDocumentTheme` / `initSurfaceStyle` repair that case, which is
 * why this does not throw: a stale template must still serve a page.
 */
export function applyShellDocumentFacts(html: string, facts: ShellDocumentFacts): string {
  return html
    .replace(
      TEMPLATE_THEME,
      `data-theme="${facts.palette.id}"${styleAttributes(facts.surfaceStyle, facts.iconStyle, facts.palette)}`,
    )
    .replace(TEMPLATE_VARIANT, `data-theme-variant="${facts.palette.variant}"`)
    .replace(TEMPLATE_META, `<meta name="theme-color" content="${facts.chromeColor}" />`);
}
