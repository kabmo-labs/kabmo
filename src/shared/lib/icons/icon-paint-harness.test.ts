/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The harness families inside the generated paint sheet.
 *
 * Kept beside `icon-paint-css.test.ts` rather than in it because the sheet is one
 * string and the harness rules are the only family with TWO layers: a brand row
 * per logo (gated on the colour mode, like every other brand) and a surface row
 * per HARNESS, for the vendor whose two transports share one logo.
 *
 * The ordering assertions are the load-bearing half. Both layers are the same
 * statement at the same specificity, so only document order decides who wins —
 * and a surface rule stated first would be silently overwritten by the brand row
 * it exists to correct.
 */

import { describe, expect, test } from 'bun:test';

import { iconPaintStyleSheet } from '@/shared/lib/icons/icon-paint-css';
import { HARNESS_BRAND_COLORS, HARNESS_SURFACE_COLORS } from '@/shared/lib/harness/brand-color';

const css = iconPaintStyleSheet();

describe('harness paint', () => {
  test('every brand row paints both variants', () => {
    for (const [name, entry] of Object.entries(HARNESS_BRAND_COLORS)) {
      const selector = `svg[data-harness="${name}"]`;
      expect(css).toContain(`:where(${selector}) { --icon-color: ${entry.light}; }`);
      expect(css).toContain(`--icon-color: ${entry.dark ?? 'var(--theme-ink)'}; }`);
    }
  });

  test('a harness SURFACE overrides the one brand its transports share', () => {
    // Both omp transports draw the same brand key, so the brand rule paints them
    // the same colour. The tab is now the mark alone, which leaves the hue as the
    // only thing distinguishing them — so the per-surface rules must exist AND
    // come after the brand rows.
    const brandIndex = css.lastIndexOf('svg[data-harness="omp"]');
    for (const [id, entry] of Object.entries(HARNESS_SURFACE_COLORS)) {
      const rule = `:where(svg[data-harness-id="${id}"]) { --icon-color: ${entry.light}; }`;
      expect(css).toContain(rule);
      expect(css).toContain(`--icon-color: ${entry.dark ?? 'var(--theme-ink)'}; }`);
      expect(css.indexOf(rule), `${id} must follow the brand rows`).toBeGreaterThan(brandIndex);
    }
  });

  test('the composer tab strip keeps its two omp hues in BOTH modes', () => {
    // Measured with the label gone: in monochrome both omp marks computed the
    // same ink, so the strip showed two identical glyphs naming two transports.
    // The hue is the name there, so these rules are NOT gated on the colour mode
    // — and they come last, because they also have to beat the colour mode's own
    // `color` statement on the same element.
    for (const [id, entry] of Object.entries(HARNESS_SURFACE_COLORS)) {
      const rule = `[data-harness-tabs] svg[data-harness-id="${id}"] { color: ${entry.light}; }`;
      expect(css).toContain(rule);
      expect(css).toContain(
        `:root[data-theme-variant="dark"] [data-harness-tabs] svg[data-harness-id="${id}"] { color: ${entry.dark ?? entry.light}; }`,
      );
    }
    // Both statement forms, and after the paint rule that sets `color`.
    const paintIndex = css.indexOf('{ --icon-paint: var(--icon-color); color: var(--icon-paint); }');
    expect(css.indexOf('[data-harness-tabs] svg[data-harness-id="omp-acp"]')).toBeGreaterThan(paintIndex);
  });

  test('an inverted badge still takes its own foreground over the brand hue', () => {
    // The generating indicator and the answer footer fill `bg-ink`; a brand hue on
    // the palette's own foreground is illegible in one of the two themes.
    expect(css).toContain('[data-icon-style="color"] .bg-ink svg[data-harness] { color: currentColor; }');
  });
});
