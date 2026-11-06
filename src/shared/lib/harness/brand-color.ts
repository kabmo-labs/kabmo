/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The brand colour of every harness mark, derived the same way provider marks
 * are.
 *
 * **`base` is the brand's OWN hex and nothing else.** The two values that get
 * painted come from {@link legiblePair} against the palettes this build ships,
 * because one hex cannot clear contrast on both a light and a dark paper —
 * `claude`'s `#D97757` is a measured example in the provider table.
 *
 * **`dark: null` means "draw it in the theme's ink".** omp, pi and cursor publish
 * near-monochrome marks (`#000000`, or a gradient that reads as one); mixing a
 * black toward white lands on grey, which is indistinguishable from the ink it
 * was meant to replace while claiming to be a brand colour. That is the honest
 * half of full-colour mode: brand colour WHERE ONE EXISTS, never a tint invented
 * to fill a row.
 *
 * Sources: the vendor's colour variant in `@lobehub/icons-static-svg`, and for
 * omp its own `favicon.svg` gradient stops (`#ed4abf → #9b4dff → #5ad8e6`) of
 * which the middle stop is the one that reads as the brand.
 */

import { legiblePair } from '@/shared/lib/theme/legibility';

/** The brand's own hex per harness glyph name (`harness-glyph/brands.ts`). */
const HARNESS_BASES: Readonly<Record<string, string>> = {
  // The favicon's gradient midpoint: the hue a reader recognises as omp.
  omp: '#9b4dff',
  claudecode: '#D97757',
  codex: '#3941FF',
  opencode: '#000000',
  deepseek: '#5786FE',
  commandcode: '#000000',
  pi: '#000000',
  kimi: '#000000',
  minimax: '#E73562',
  qwen: '#6950EF',
  cursor: '#000000',
  // A multi-stop mark; the blue stop is the one its own dominant uses carry.
  antigravity: '#3186FF',
};

/**
 * The two omp SURFACES, told apart by colour.
 *
 * A brand table is keyed by the vendor's mark, and omp publishes ONE — so
 * `omp-rpc` and `omp-acp` drew the same purple, which is correct while a tab
 * carries the words "omp" and "omp (ACP)" beside it and wrong the moment the tab
 * is the mark alone: two identical glyphs side by side, naming two different
 * transports. The hue is what carries the difference, and the purple is omp's
 * own (the favicon's gradient midpoint) with the ACP surface moved to red.
 *
 * Keyed by `HarnessId`, not by glyph: this layer exists precisely for the case a
 * glyph cannot express, so it must never be consulted a second time for one.
 */
const HARNESS_SURFACE_BASES: Readonly<Record<string, string>> = {
  'omp-rpc': '#9b4dff',
  'omp-acp': '#dc2626',
};

export interface HarnessBrandColor {
  /** The vendor's published hex, as-is (for tests and documentation). */
  base: string;
  light: string;
  dark: string | null;
}

/** The per-surface table, solved by the same rule as the brand table. */
export const HARNESS_SURFACE_COLORS: Readonly<Record<string, HarnessBrandColor>> = Object.fromEntries(
  Object.entries(HARNESS_SURFACE_BASES).map(([id, base]) => [id, { base, ...legiblePair(base) }]),
);

export const HARNESS_BRAND_COLORS: Readonly<Record<string, HarnessBrandColor>> = Object.fromEntries(
  Object.entries(HARNESS_BASES).map(([name, base]) => [name, { base, ...legiblePair(base) }]),
);

/**
 * The colour a harness mark is painted in, or `null` for the theme ink.
 *
 * `name` may be a harness ID or a brand glyph key. The SURFACE table wins: when
 * two transports share one mark, the id is the only thing that can tell them
 * apart, and it is the more specific answer.
 */
export function harnessColorFor(name: string | null | undefined, variant: 'light' | 'dark'): string | null {
  if (!name) return null;
  const entry = HARNESS_SURFACE_COLORS[name] ?? HARNESS_BRAND_COLORS[name];
  if (!entry) return null;
  return variant === 'dark' ? entry.dark : entry.light;
}
