/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * How legible a brand colour is on the palettes this build actually ships.
 *
 * Brand art arrives with ONE hex, chosen by the brand for its own background.
 * Kabmo paints it on 63 palettes, so "the brand's colour" is not paintable
 * as-is: measured, `claude`'s `#D97757` reads 2.77:1 on `#f4f1ea` (the darkest
 * light paper shipped) while it is 5.25:1 on `#201E2B` (the lightest dark one).
 * This module is the one place that decides what to paint instead, so the
 * provider table and the file-type table cannot disagree about the rule.
 *
 * Two properties are load-bearing:
 *
 * - **The worst surface is MEASURED, not assumed.** It is the minimum contrast
 *   against every palette of that variant (`THEMES`), not against one hardcoded
 *   hex — a new palette with a mid-tone paper would otherwise silently drop a
 *   mark below the floor. Cost is 63 comparisons per brand, once per process.
 * - **A near-monochrome brand gets NO dark value.** `#000000` mixed toward white
 *   lands on `#737373`, which is indistinguishable from the ink it was meant to
 *   replace while claiming to be a brand colour; those brands are drawn in the
 *   theme's ink instead (`dark: null`), which is what the reference
 *   implementation does with `filter: invert()`.
 */

import { THEMES } from '@/shared/lib/theme/catalog';
import { mixHex, parseHexColor, relativeLuminance } from '@/shared/lib/theme/color';

/** WCAG's non-text floor: an icon is a graphic, not body copy. */
export const BRAND_CONTRAST_FLOOR = 3;

/** Below this channel spread a hex carries no hue worth keeping. */
const MONOCHROME_CHROMA = 24;

/** The largest step the mixer takes while searching for a legible shade. */
const MIX_STEP = 5;
const MIX_MAX = 95;

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Channel spread of a hex: at most 24 apart means the art is monochrome. */
export function isNearMonochrome(hex: string): boolean {
  const color = parseHexColor(hex);
  if (!color) return true;
  return Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b) < MONOCHROME_CHROMA;
}

/**
 * The lowest contrast `color` reaches on any palette surface of `variant`.
 *
 * `paper` is the surface a mark is drawn on (a plate, a row, a card); the
 * canvas is behind panels and never touches a mark directly.
 */
export function worstSurfaceContrast(color: string, variant: 'light' | 'dark'): number {
  let worst = Number.POSITIVE_INFINITY;
  for (const theme of THEMES) {
    if (theme.variant !== variant) continue;
    worst = Math.min(worst, contrastRatio(color, theme.paper));
  }
  return worst === Number.POSITIVE_INFINITY ? BRAND_CONTRAST_FLOOR : worst;
}

/** `hex` moved toward `toward` in 5% steps until it clears the floor. */
function legibleToward(hex: string, toward: string, variant: 'light' | 'dark'): string {
  if (worstSurfaceContrast(hex, variant) >= BRAND_CONTRAST_FLOOR) return hex;
  for (let percent = MIX_STEP; percent <= MIX_MAX; percent += MIX_STEP) {
    const mixed = mixHex(hex, toward, percent / 100);
    if (worstSurfaceContrast(mixed, variant) >= BRAND_CONTRAST_FLOOR) return mixed;
  }
  return hex;
}

/**
 * The two values a brand colour is painted in.
 *
 * The light value is the brand hex, or the same hue mixed toward black until it
 * clears the floor on every light palette; the dark value is the mirror image
 * toward white. `dark: null` means "this brand is monochrome art — draw it in
 * the theme's ink", which is the only honest answer for a black logo.
 */
export function legiblePair(base: string): { light: string; dark: string | null } {
  const light = legibleToward(base, '#000000', 'light');
  const dark = isNearMonochrome(base) ? null : legibleToward(base, '#ffffff', 'dark');
  return { light, dark };
}
