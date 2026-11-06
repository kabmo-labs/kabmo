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
 *
 * Raising the cap is NOT the lever for a DULL hue: the rows that read greyest
 * (teal/cyan) sit at the sRGB gamut boundary for their lightness, so a bigger cap
 * changes nothing there. It IS the lever for "more alive": measured, lifting
 * 0.19 → 0.22 takes the light table's mean chroma 0.167 → **0.180** with the
 * worst painted contrast unchanged at 3.15:1, and 0 rows below the floor over
 * all 32 light palettes. Above 0.25 only magenta and red move, toward neon.
 */
export const ICON_TONE_CHROMA_CAP = 0.22;

/**
 * Lightnesses the LIGHT solver may use, brightest first.
 *
 * The ladder exists only to enumerate candidates; the ORDER the solver prefers is
 * stated in `solveIconTone`. Brightest-first is the order the user's report asked
 * for: "aku perlu lebih cerah untuk icon di light mode".
 */
const LIGHT_LADDER = Array.from({ length: 61 }, (_, index) => 0.90 - index * 0.01);

/**
 * How bright a palette's paper is, as the three groups the LIGHT tone table is
 * solved for.
 *
 * One table for all 32 light palettes is solved against the DARKEST paper
 * (`tokyonight-light` `#dee0ee`) so that every palette clears the floor — which
 * means the 24 palettes with a brighter paper paint an icon at lightness the
 * catalog already grants more of. Measured on the default `paper` (`#faf8f3`):
 * the shared table lands at mean L **0.582** where that paper allows **0.640**,
 * a 0.05 gap that reads as "light mode kusam" beside dark's 0.782.
 *
 * Splitting the solve removes most of that gap without a table per palette:
 * measured over the 32 light palettes, three buckets lift the weighted mean from
 * **0.589 to 0.620**, and six buckets only reach 0.625 — so the extra rows buy
 * nothing. Every row still clears 3.15:1 on every paper of its own bucket
 * (verified per palette, 1152/1152 rows).
 *
 * The thresholds are on RELATIVE LUMINANCE, not OKLCH lightness, because that is
 * the quantity contrast is computed from: `#dee0ee` and `#faf8f3` differ by 0.06
 * in OKLCH L but by 0.19 in luminance.
 */
export type PaperBucket = 'deepest' | 'deeper' | 'deep' | 'mid' | 'light' | 'bright';

/**
 * Luminance at which each bucket ends, ascending.
 *
 * Six groups rather than three because three stopped paying: measured over the 32
 * light palettes (weighted), three buckets reach mean L 0.6222 and six reach
 * **0.6291** — the same solve per palette tops out at 0.6335, so six buckets buy
 * 78% of the available headroom for 216 generated rows instead of 1080. The edges
 * are midway between consecutive papers in the catalog, which is why they look
 * arbitrary: they are derived, and `icon-tone.test.ts` re-derives them.
 */
export const PAPER_BUCKET_EDGES = [0.8503, 0.8888, 0.9137, 0.9433, 1.0] as const;

/** Every bucket, deepest first — the order the tables are generated in. */
export const PAPER_BUCKETS: readonly PaperBucket[] = ['deepest', 'deeper', 'deep', 'mid', 'light', 'bright'];

/**
 * Lightnesses the DARK solver may use, lightest first — ties prefer the lighter.
 *
 * Dark used to be ONE `hsl(H 65% 70%)` for every hue, and the measured cost is a
 * lightness spread of **0.25** (L 0.65 at hue 240 against L 0.90 at hue 60): the
 * same mode draws a blue icon markedly heavier than the yellow one beside it,
 * which is the inconsistency the light side was solved out of.
 *
 * The band is a BAND, not a ladder from black to white, and that is the whole
 * fix. Solved per hue with no bound, the solver still spreads 0.20 — it spends
 * every point of lightness the dark palettes would allow chasing chroma. Pinned
 * to 0.74-0.82 it cannot: measured over the 36 hues, the spread falls to
 * **0.08** while the mean chroma RISES 0.126 → 0.170 and the muddiest row goes
 * 0.082 → 0.134, every row still clearing 3.15:1 on all 31 dark papers.
 */
const DARK_LIGHTNESS_LADDER = [
  0.82, 0.81, 0.8, 0.79, 0.78, 0.77, 0.76, 0.75, 0.74,
];

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

/**
 * Which bucket a paper falls in, by the luminance the contrast is computed from.
 */
export function paperBucketOf(paper: string): PaperBucket {
  const color = parseHexColor(paper);
  if (!color) return 'deep';
  const lin = (raw: number) => {
    const c = raw / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * lin(color.r) + 0.7152 * lin(color.g) + 0.0722 * lin(color.b);
  const index = PAPER_BUCKET_EDGES.findIndex((edge) => luminance < edge);
  return PAPER_BUCKETS[index === -1 ? PAPER_BUCKETS.length - 1 : index]!;
}

/**
 * The darkest paper of a bucket — what its table is solved against.
 *
 * The bucket's OWN worst paper, not the catalog's: that is the whole point of
 * splitting, and it is what makes a `bright` row brighter than a `deep` row
 * while both still clear the floor on every palette that uses them.
 */
function bucketPaper(bucket: PaperBucket): string {
  let darkest: { paper: string; luminance: number } | null = null;
  const lin = (raw: number) => {
    const c = raw / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  for (const theme of THEMES) {
    if (theme.variant !== 'light') continue;
    if (paperBucketOf(theme.paper) !== bucket) continue;
    const color = parseHexColor(theme.paper);
    if (!color) continue;
    const luminance = 0.2126 * lin(color.r) + 0.7152 * lin(color.g) + 0.0722 * lin(color.b);
    if (!darkest || luminance < darkest.luminance) darkest = { paper: theme.paper, luminance };
  }
  return darkest?.paper ?? '#dee0ee';
}

/** The lowest contrast `hex` reaches on any paper of `variant` (and bucket). */
function worstVariantContrast(hex: string, variant: 'light' | 'dark', paper?: string): number {
  let worst = Number.POSITIVE_INFINITY;
  for (const theme of THEMES) {
    if (theme.variant !== variant) continue;
    if (paper && paperBucketOf(theme.paper) !== paperBucketOf(paper)) continue;
    worst = Math.min(worst, contrastRatio(hex, theme.paper));
  }
  return worst === Number.POSITIVE_INFINITY ? BRAND_CONTRAST_FLOOR : worst;
}

/**
 * The tone for ONE wheel hue in ONE variant — and, on the light side, ONE paper
 * bucket.
 *
 * `saturation`/`lightness` are the pair the mode used to paint with, and they
 * are only used to NAME the colour: `hsl(H 60% 30%)` (light) and `hsl(H 65% 70%)`
 * (dark) are hue `H` as this app already means it, and the OKLCH hue angle of
 * that paint is what every candidate keeps.
 *
 * The rule is identical for both variants — keep the hue, take the most chroma
 * sRGB can show at a legal lightness, prefer chroma then the lighter candidate —
 * because the complaint and the fix are the same on either side: a single pair
 * spends its whole budget on the worst hue and leaves the muddiest row at less
 * than half the chroma of the vividest one.
 *
 * The `bucket` picks which papers the floor is measured against, which is how
 * the light side stops painting every icon at the lightness the darkest paper in
 * the catalog merely tolerates. Dark has one band for every palette, so it
 * ignores the argument.
 */
export function solveIconTone(
  wheelHue: number,
  variant: 'light' | 'dark' = 'light',
  bucket: PaperBucket = 'deep',
  saturation = variant === 'light' ? 60 : 65,
  lightness = variant === 'light' ? 30 : 70,
): string {
  const colorHue = oklchOf(hslToHex(wheelHue, saturation, lightness)).hue;
  const ladder = variant === 'light' ? LIGHT_LADDER : DARK_LIGHTNESS_LADDER;
  const paper = variant === 'light' ? bucketPaper(bucket) : undefined;
  let best: { hex: string; chroma: number; lightness: number } | null = null;
  let darkest = '';
  for (const candidate of ladder) {
    const chroma = Math.min(ICON_TONE_CHROMA_CAP, maxChromaInGamut(candidate, colorHue));
    const paint = oklchToRgb(candidate, Math.max(chroma, 0.02), colorHue);
    const hex = rgbaToHex(paint);
    darkest = hex;
    if (!paint.inGamut) continue;
    if (worstVariantContrast(hex, variant, paper) < ICON_TONE_CONTRAST) continue;
    // LIGHT prefers the BRIGHTEST legal candidate, then the most chroma; dark
    // prefers chroma, then lightness. The order is the report: "aku perlu lebih
    // cerah untuk icon di light mode" — and the previous chroma-first order was
    // spending lightness to buy chroma the hue could not use anyway. Dark was
    // never reported as dull, so its order is left exactly as it was.
    const better = !best || (variant === 'light'
      ? candidate > best.lightness + 1e-6 || (Math.abs(candidate - best.lightness) <= 1e-6 && chroma > best.chroma)
      : chroma > best.chroma + 1e-6 || (Math.abs(chroma - best.chroma) <= 1e-6 && candidate > best.lightness));
    if (better) best = { hex, chroma, lightness: candidate };
  }
  return best?.hex ?? darkest;
}

/**
 * Every wheel hue's tone: what the generator writes to disk.
 *
 * Light is keyed by bucket (`ICON_TONES` holds all three); dark has one band.
 */
export function solveIconTones(variant: 'light' | 'dark' = 'light', bucket: PaperBucket = 'deep'): Record<number, string> {
  return Object.fromEntries(ICON_TONE_WHEEL.map((hue) => [hue, solveIconTone(hue, variant, bucket)]));
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
