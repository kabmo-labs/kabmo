/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The LIGHT tone of a generated hue — solved, not stated as one pair.
 *
 * ## The bug this answers
 *
 * `color` mode painted every light icon with one `hsl(H 60% 30%)`, and the
 * report was that icons look muddy in light mode while the same icons look
 * bright in dark ("warna icon di mode full color ketika light mode kelihatan
 * kusem"). Measured, the cause is not rendering. That pair is pinned to the 3:1
 * non-text floor, so its saturation is whatever the WORST hue tolerates — and
 * chroma is not evenly distributed on the wheel. Over the 36 generated hues the
 * pair spans OKLCH chroma **0.075** (hue 190) to **0.164** (hue 120), mean
 * **0.121**, while dark's `hsl(H 65% 70%)` reaches **0.126** with 4.07:1 of
 * headroom left over. Light spent its entire legibility budget and still had
 * less colour than dark, which never had to spend anything.
 *
 * One pair cannot fix that. Raising it to `85%` drops the worst hue to 2.66:1
 * and `100%` to 2.32:1 — under the floor. Gamut, not taste, is the binding
 * constraint, and it binds differently at every hue, so the tone is solved per
 * hue.
 *
 * ## The rule
 *
 * Keep the hue; take the most chroma sRGB can show at that lightness, capped at
 * {@link ICON_TONE_CHROMA_CAP}; keep only lightnesses where the painted byte
 * clears {@link ICON_TONE_CONTRAST} on EVERY light palette this build ships.
 * Prefer the most chroma, then the lighter candidate (a lighter tone of equal
 * chroma reads less heavy beside ink text).
 *
 * Over the same 36 hues: mean chroma **0.121 → 0.162 (×1.34)**, the muddiest
 * row (hue 190) **0.075 → 0.102** and hue 200 **0.078 → 0.121**, every hue
 * improves, and the worst painted contrast stays at 3.15.
 *
 * ## Why the answer is a generated table, not a call
 *
 * The solve needs `THEMES`, and the client must not pay 11k contrast checks on
 * load — nor carry the palette table just to colour a plugin's initials. So
 * `scripts/icon-tints.mjs` runs this module at build time and emits `ICON_TONES`
 * into `tint-hues.generated.ts`; runtime is a lookup shipped in that file. The
 * suite compares the table against this solver, so a palette added later cannot
 * leave a stale, sub-floor tone behind.
 *
 * ## What it deliberately does not do
 *
 * - **Dark is untouched.** It reads bright already; raising its chroma would
 *   only invert the complaint.
 * - **The hue is the OKLCH hue of the old paint**, not the raw wheel number.
 *   HSL's `210` and OKLCH's `210` are different colours; deriving one from the
 *   other keeps "hue 210 is that blue" true across the change.
 */

import { THEMES } from '@/shared/lib/theme/catalog';
import { BRAND_CONTRAST_FLOOR, contrastRatio } from '@/shared/lib/theme/legibility';
import { maxChromaInGamut, oklchToRgb, parseHexColor, rgbaToHex } from '@/shared/lib/theme/color';

/**
 * The contrast a tone must clear on every light palette, with headroom ON TOP of
 * the WCAG floor.
 *
 * Quantizing to 8-bit hex moves the achieved ratio by up to ~0.15, so a tone
 * solved at exactly 3.0 can paint at 2.87. 3.15 is the measured value at which
 * the painted byte is still clear of {@link BRAND_CONTRAST_FLOOR}.
 */
export const ICON_TONE_CONTRAST = 3.15;

/**
 * The most chroma a generated tone may carry.
 *
 * Uncapped, the solver hands magenta `C 0.25` (`#f00580`) — all the chroma sRGB
 * can show at that lightness. Measured, that reads as a neon sign beside a
 * toolbar glyph, not as a hue. 0.19 keeps every capped hue vivid and leaves the
 * ones that cannot reach it (yellow, teal) at their gamut maximum.
 */
export const ICON_TONE_CHROMA_CAP = 0.19;

/** Lightnesses the solver may use, lightest first — ties prefer the lighter. */
const LIGHTNESS_LADDER = [0.62, 0.6, 0.58, 0.56, 0.54, 0.52, 0.5, 0.48, 0.46, 0.44, 0.4];

/** The wheel the generated hues land on: 36 steps of 10°. */
export const ICON_TONE_WHEEL = Array.from({ length: 36 }, (_, index) => index * 10);

/**
 * OKLCH of a painted hex — what "the same colour, brighter" is measured in.
 *
 * Used by the solver (to keep the hue) and by the suite (to prove the light tone
 * carries more chroma than the pair it replaced, which is the whole report).
 */
export function oklchOf(hex: string): { lightness: number; chroma: number; hue: number } {
  const color = parseHexColor(hex);
  if (!color) return { lightness: 0, chroma: 0, hue: 0 };
  const lin = (raw: number) => {
    const c = raw / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = lin(color.r);
  const g = lin(color.g);
  const b = lin(color.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return {
    lightness,
    chroma: Math.hypot(a, bb),
    hue: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360,
  };
}

/** The lowest contrast `hex` reaches on any light palette's surface. */
function worstLightContrast(hex: string): number {
  let worst = Number.POSITIVE_INFINITY;
  for (const theme of THEMES) {
    if (theme.variant !== 'light') continue;
    worst = Math.min(worst, contrastRatio(hex, theme.paper));
  }
  return worst === Number.POSITIVE_INFINITY ? BRAND_CONTRAST_FLOOR : worst;
}

/**
 * The tone for ONE wheel hue, given the pair the mode used to paint with.
 *
 * `saturation`/`lightness` are the OLD constants, and they are only used to name
 * the colour: `hsl(H 60% 30%)` is hue `H` as this app already means it, and its
 * OKLCH hue angle is what gets kept.
 */
export function solveIconTone(wheelHue: number, saturation = 60, lightness = 30): string {
  const colorHue = oklchOf(hslToHex(wheelHue, saturation, lightness)).hue;
  let best: { hex: string; chroma: number; lightness: number } | null = null;
  let darkest = '';
  for (const candidate of LIGHTNESS_LADDER) {
    const chroma = Math.min(ICON_TONE_CHROMA_CAP, maxChromaInGamut(candidate, colorHue));
    const paint = oklchToRgb(candidate, Math.max(chroma, 0.02), colorHue);
    const hex = rgbaToHex(paint);
    darkest = hex;
    if (!paint.inGamut) continue;
    if (worstLightContrast(hex) < ICON_TONE_CONTRAST) continue;
    const better = !best || chroma > best.chroma + 1e-6 || (Math.abs(chroma - best.chroma) <= 1e-6 && candidate > best.lightness);
    if (better) best = { hex, chroma, lightness: candidate };
  }
  return best?.hex ?? darkest;
}

/** Every wheel hue's light tone: what the generator writes to disk. */
export function solveIconTones(): Record<number, string> {
  return Object.fromEntries(ICON_TONE_WHEEL.map((hue) => [hue, solveIconTone(hue)]));
}

/** `hsl(h <saturation>% <lightness>%)` as `#rrggbb` — the paint this module replaces. */
export function hslToHex(hue: number, saturation: number, lightness: number): string {
  const s = saturation / 100;
  const l = lightness / 100;
  const k = (n: number) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const byte = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255);
  return `#${[channel(0), channel(8), channel(4)]
    .map((value) => byte(value).toString(16).padStart(2, '0'))
    .join('')}`;
}
