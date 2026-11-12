/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';
import { THEMES } from '@/shared/lib/theme/catalog';
import { mixHex } from '@/shared/lib/theme/color';
import { contrastRatio } from '@/shared/lib/theme/legibility';
import { readClientCss as read, ruleBody } from '@/test-support/glass-css';

/**
 * The material has to hold on EVERY palette in the catalog, not on the eighteen
 * it was tuned against.
 *
 * The material is DERIVED from the palette — `--glass-panel` is
 * `color-mix(paper N%, transparent)` and the chrome is one more mix over it — so
 * a theme does not "support glass" by declaring something; it supports it when
 * its two surfaces and its ink survive the composite. That makes a bad port
 * invisible in the classic look and illegible under the material, which is the
 * failure this sweep exists to catch.
 *
 * The alphas are read out of `glass.css` rather than repeated here, so the test
 * cannot drift from the shipped values, and the composite is the browser's own:
 * plane = paper over canvas, chrome/card = paper over plane. The invariant a new
 * palette breaks without anyone noticing is body text keeping the 4.5:1 floor on
 * the chrome and on a card. Measured across all 63 palettes, the worst is
 * `solarized-light` at 4.89:1 — the same number its opaque paper has, which is
 * what "the tint costs no contrast" means.
 */
describe('glass material on every catalog palette', () => {
  /** A percentage out of a token, whether bare (`50%`) or inside a `color-mix`. */
  const percentOf = (body: string, token: string): number => {
    const match = new RegExp(`--glass-${token}:\\s*(?:color-mix\\(in srgb, var\\(--theme-paper\\)\\s*)?(\\d+(?:\\.\\d+)?)%`).exec(body);
    if (!match) throw new Error(`--glass-${token} is not a percentage in this block`);
    return Number(match[1]) / 100;
  };

  test('body text keeps the 4.5:1 floor on the plane, the chrome and a card', async () => {
    const glass = await read('./glass.css');
    const surface = ruleBody(glass, '[data-surface="glass"]');
    const surfaceDark = ruleBody(glass, '[data-surface="glass"][data-theme-variant="dark"]');
    const root = ruleBody(glass, ':root');
    const variantDark = ruleBody(glass, '[data-theme-variant="dark"]');

    // The card's fill is surface-INDEPENDENT (the composer's `glass` style is
    // offered in the classic look too), so it lives on `:root` and the variant
    // block, not under the surface attribute.
    const alphas = {
      light: { tint: percentOf(surface, 'tint'), chrome: percentOf(surface, 'chrome'), card: percentOf(root, 'card') },
      dark: { tint: percentOf(surfaceDark, 'tint'), chrome: percentOf(surfaceDark, 'chrome'), card: percentOf(variantDark, 'card') },
    };
    expect(alphas.light.tint).toBeGreaterThan(alphas.dark.tint - 1);
    expect(alphas.light.chrome).toBeLessThan(alphas.dark.chrome + 0.5);

    const failures: string[] = [];
    for (const theme of THEMES) {
      const alpha = alphas[theme.variant];
      const plane = mixHex(theme.canvas, theme.paper, alpha.tint);
      const tiers = {
        plane,
        chrome: mixHex(plane, theme.paper, alpha.chrome),
        card: mixHex(plane, theme.paper, alpha.card),
      };
      for (const [tier, fill] of Object.entries(tiers)) {
        const ratio = contrastRatio(theme.ink, fill);
        if (ratio < 4.5) failures.push(`${theme.id} ${tier} ${ratio.toFixed(2)}:1`);
      }
    }
    expect(failures).toEqual([]);
  });
});
