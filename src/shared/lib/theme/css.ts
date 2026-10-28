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
  const lines = [
    `  --theme-paper: ${theme.paper};`,
    `  --theme-canvas: ${theme.canvas};`,
    `  --theme-ink: ${theme.ink};`,
    `  --theme-error: ${theme.error};`,
    `  --theme-success: ${theme.success};`,
    `  --theme-info: ${theme.info};`,
    `  --theme-warning: ${theme.warning};`,
    `  --theme-meta: ${theme.meta};`,
  ];
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
