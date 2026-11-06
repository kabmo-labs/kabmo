/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The HARNESS marks' paint, split out of `icon-paint-css.ts` so that sheet stays
 * readable. Not independent: these are two of the families it concatenates.
 *
 * Two layers live here, and the second exists because the first cannot express
 * one real case:
 *
 * 1. **The brand** (`data-harness`) — the agent's own colour, gated on the colour
 *    mode like every other brand family, so `monochrome` leaves it in the ink.
 * 2. **The surface** (`data-harness-id`) — the same statement keyed by HARNESS
 *    rather than by logo, for a vendor publishing ONE mark for two transports.
 *    omp is exactly that: `omp-rpc` and `omp-acp` share the art, so the brand row
 *    paints them the same purple.
 */

import { HARNESS_BRAND_COLORS, HARNESS_SURFACE_COLORS } from '@/shared/lib/harness/brand-color';

/** Both rules for one brand, since a brand colour has two values. */
function brandRules(selector: string, light: string, dark: string | null): string[] {
  return [
    `:where([data-icon-style="color"]) :where(${selector}) { --icon-color: ${light}; }`,
    `:where([data-icon-style="color"][data-theme-variant="dark"]) :where(${selector}) { --icon-color: ${dark ?? 'var(--theme-ink)'}; }`,
  ];
}

/**
 * Every harness mark's brand colour, then the per-surface overrides after it.
 *
 * The order is the contract: an override and the brand row it corrects are the
 * same statement at the same specificity, so only order can let `omp-acp` win
 * over the one `omp` brand both transports share. Stated first, the red would be
 * overwritten by the purple a line above it.
 */
export function harnessBrandRules(): string[] {
  return [
    ...Object.entries(HARNESS_BRAND_COLORS).flatMap(([name, entry]) =>
      brandRules(`svg[data-harness="${name}"]`, entry.light, entry.dark),
    ),
    ...Object.entries(HARNESS_SURFACE_COLORS).flatMap(([id, entry]) =>
      brandRules(`svg[data-harness-id="${id}"]`, entry.light, entry.dark),
    ),
  ];
}

/**
 * The composer's tab strip paints its TWO omp surfaces in BOTH modes.
 *
 * The one place a harness hue is not a decoration to be dropped when the user
 * picks monochrome, and the reason is structural: `omp-rpc` and `omp-acp` draw
 * the SAME brand art, the strip prints no label, and measured with the label
 * gone, both marks computed the identical ink (`rgb(101, 99, 95)`) — two glyphs
 * side by side, indistinguishable, naming two different transports. The hue IS
 * the name here, so it survives the mode that repaints every other icon; every
 * other harness mark still follows the mode.
 *
 * `color` on the svg rather than `--icon-color`: under the colour mode the paint
 * rule also sets `color` at (0,2,1), and these rules are emitted LAST at the same
 * weight, so order is what lets the surface win — the same contract as the gated
 * rows above.
 */
export function harnessTabSurfaceRules(): string[] {
  const rules: string[] = [];
  for (const [id, entry] of Object.entries(HARNESS_SURFACE_COLORS)) {
    rules.push(`[data-harness-tabs] svg[data-harness-id="${id}"] { color: ${entry.light}; }`);
    rules.push(
      `:root[data-theme-variant="dark"] [data-harness-tabs] svg[data-harness-id="${id}"] { color: ${entry.dark ?? entry.light}; }`,
    );
  }
  return rules;
}
