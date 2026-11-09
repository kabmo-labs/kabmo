/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `[data-theme]` CSS for every palette in the catalog, as one string.
 *
 * Generated rather than hand-written because the palette values already exist
 * in TypeScript — the appearance cards render the same eight colors as chips —
 * so a second hand-maintained copy in `tailwind.css` would be 45 blocks that
 * drift from the cards the moment either side is edited.
 *
 * Two details are load-bearing:
 *
 * - **Selector specificity is `html[data-theme=…]`, not `[data-theme=…]`.**
 *   `tailwind.css` carries the default palette on `:root`, which is also
 *   (0,1,0); at equal specificity the later declaration wins by document order,
 *   so a bare attribute selector injected before the stylesheet would lose and
 *   every theme would render as `paper`.
 * - **`color-scheme` is set per variant.** Scrollbars, form controls and the
 *   browser's own canvas background are painted by the UA from it; without it a
 *   dark theme keeps white scrollbars and a white overscroll area.
 *
 * No DOM here — the SSR shell inlines this, and the client injects the same
 * string only when a served document predates it.
 */

import type { ThemePalette } from '@/shared/types/theme';
import { THEMES } from '@/shared/lib/theme/catalog';
import {
  MUTED_STEPS,
  SIGNAL_SLOTS,
  inkScale,
  onInkTextColor,
  signalTextColor,
} from '@/shared/lib/theme/ink-scale';

/** The `<style>` element's id: the SSR shell writes it, the client checks it. */
export const THEME_STYLE_ELEMENT_ID = 'omp-theme-palettes';

/**
 * A hover shade of a signal color, mixed toward the theme's own ink so the
 * direction follows the palette: darker on a light theme, lighter on a dark one.
 * `--theme-info-hover` / `--theme-warning-hover` used to be fixed hex values in
 * `tailwind.css` and could only be right for one palette.
 */
const HOVER_MIXES: ReadonlyArray<readonly [string, string]> = [
  ['--theme-info-hover', '--theme-info'],
  ['--theme-warning-hover', '--theme-warning'],
];

function paletteBlock(theme: ThemePalette): string {
  const scale = inkScale(theme);
  const lines = [
    `  --theme-paper: ${theme.paper};`,
    `  --theme-canvas: ${theme.canvas};`,
    `  --theme-ink: ${theme.ink};`,
    // Fifteen distinct values: the ink at N% over this palette's paper.
    ...scale.ladder.map((value, index) => `  --theme-ink-${MUTED_STEPS[index]}: ${value};`),
    // The inline-code chip's OWN fill, opaque (see `CODE_FILL_PERCENT`).
    `  --theme-code-fill: ${scale.codeFill};`,
    // Muted text on an inverted surface: an alpha reads 2.91:1 on `solarized-light`.
    `  --theme-on-ink-muted: ${onInkTextColor(theme)};`,
    // The one level that clears AA on THIS palette. No single rung can be legal
    // everywhere: the measured floor ranges from `/50` to `/90` across the 63.
    `  --theme-muted: ${scale.muted};`,
    `  --theme-error: ${theme.error};`,
    `  --theme-success: ${theme.success};`,
    `  --theme-info: ${theme.info};`,
    `  --theme-warning: ${theme.warning};`,
    `  --theme-meta: ${theme.meta};`,
  ];
  // The same five signals as READABLE TEXT. A status word is text, and the
  // palette's own signal hex is chosen for a fill: measured as text it reaches
  // 1.53:1 (`warning` on `carbonfox-light`) and fails AA on 14-22 palettes.
  for (const slot of SIGNAL_SLOTS) {
    lines.push(`  --theme-${slot}-text: ${signalTextColor(theme, slot)};`);
  }
  for (const [name, source] of HOVER_MIXES) {
    lines.push(`  ${name}: color-mix(in srgb, var(${source}) 85%, var(--theme-ink));`);
  }
  lines.push(`  color-scheme: ${theme.variant};`);
  return `html[data-theme="${theme.id}"] {\n${lines.join('\n')}\n}`;
}

/** Cached: the palette set is fixed for the life of the process. */
let cached: string | null = null;

export function themeStyleSheet(): string {
  cached ??= `/* Generated from src/shared/lib/theme/palettes — do not edit by hand. */\n${THEMES.map(paletteBlock).join('\n')}\n`;
  return cached;
}
