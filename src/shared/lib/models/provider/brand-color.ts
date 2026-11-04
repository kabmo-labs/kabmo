/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The brand colour of every provider mark Kabmo can draw in colour.
 *
 * **The table holds the brand's OWN hex, and nothing else.** The two values that
 * get painted are derived by {@link legiblePair}, against the palettes this
 * build actually ships, so there is no hand-maintained pair to drift from the
 * rule: measured, `claude`'s `#D97757` reads 2.38:1 on `tokyonight-light`'s
 * paper (`#dee0ee`) and 4.42:1 on `jetbrains-dark`'s (`#2B2D30`), so one hex
 * cannot be legible on both halves and a second value has to exist — but it is
 * computed, not typed.
 *
 * **A near-monochrome brand has no dark value** (`dark: null`): `#000000` mixed
 * toward white lands on grey, which is indistinguishable from the ink it was
 * meant to replace while claiming to be a brand colour. Those brands are drawn
 * in the theme's ink instead — the same answer the reference implementation
 * gives with `filter: invert()`.
 *
 * **Sources.** `simple-icons`' hex for the brand that owns the glyph, matched
 * through its alias list because the slug and Kabmo's glyph name differ
 * (`mistralai`/`mistral`, `googlegemini`/`gemini`, `x`/`xai`). A glyph with no
 * row — 38 of the 73 in `provider-icon/glyphs.ts` — publishes no colour, and
 * keeps the palette ink in both modes. That is the honest half of the feature:
 * `color` means "brand colour where one exists", never "every mark is
 * chromatic".
 *
 * These are third-party trademarks, used here to identify the provider each one
 * belongs to. They are not covered by this project's licence.
 */

import { legiblePair } from '@/shared/lib/theme/legibility';

/** The brand's own hex, per glyph name in `provider-icon/glyphs.ts`. */
const BRAND_BASES: Readonly<Record<string, string>> = {
  alibaba: '#FF6A00',
  anthropic: '#191919',
  apple: '#000000',
  baidu: '#2932E1',
  claude: '#D97757',
  cline: '#18181B',
  cloudflare: '#F38020',
  cursor: '#000000',
  deepseek: '#5786FE',
  gemini: '#8E75B2',
  geminicli: '#8E75B2',
  githubcopilot: '#000000',
  gitlab: '#FC6D26',
  google: '#4285F4',
  huggingface: '#FFD21E',
  kagi: '#FFB319',
  kimi: '#000000',
  lmstudio: '#000000',
  meta: '#0467DF',
  metaai: '#9844FF',
  minimax: '#E73562',
  mistral: '#FA520F',
  moonshot: '#000000',
  nvidia: '#76B900',
  ollama: '#000000',
  opencode: '#000000',
  openrouter: '#94A3B8',
  perplexity: '#1FB8CD',
  qwen: '#6950EF',
  stencil: '#5530FF',
  vercel: '#000000',
  vertexai: '#4285F4',
  vllm: '#30A2FF',
  xai: '#000000',
  xiaomi: '#FF6900',
};

export interface BrandColor {
  /** The brand's own hex, as published. Provenance and documentation. */
  base: string;
  /** Legible on every light palette; `null` means "use the theme ink". */
  light: string;
  /** Legible on every dark palette; `null` means "use the theme ink". */
  dark: string | null;
}

/** Every row, with its two painted values derived from `base`. */
export const BRAND_COLORS: Readonly<Record<string, BrandColor>> = Object.fromEntries(
  Object.entries(BRAND_BASES).map(([name, base]) => [name, { base, ...legiblePair(base) }]),
);

/**
 * The colour a mark is painted in for one variant, or `null` when it should
 * keep the surrounding ink.
 *
 * `null` covers both "no brand colour published" and "the brand is black", so a
 * caller never has to distinguish them: the answer to "what paints this mark"
 * is either a hex or the ink.
 */
export function brandColorFor(name: string | null | undefined, variant: 'light' | 'dark'): string | null {
  if (!name) return null;
  const entry = BRAND_COLORS[name];
  if (!entry) return null;
  return variant === 'dark' ? entry.dark : entry.light;
}
