/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The paper-bucket half of the generated stylesheet.
 *
 * One light tone table had to clear the floor on the DARKEST light paper in the
 * catalog, so every palette with a brighter paper painted an icon at a lightness
 * it did not need — measured on the default palette at mean L 0.582 where that
 * paper allows 0.640, against dark's 0.782. That is the report "light mode
 * kusam", and the fix is a table per bucket plus ONE attribute that picks it.
 *
 * Two properties are load-bearing here, and both fail silently:
 *
 * - **Every row carries all three light buckets AND dark.** A row stamped with
 *   only the deep tone paints every bright palette with the dark paper's answer.
 * - **`deep` has no selector.** `--icon-tone` IS the deep value, so a document
 *   that never writes the attribute still paints a legal colour rather than
 *   falling through to nothing.
 */

import { describe, expect, test } from 'bun:test';
import { iconPaintStyleSheet } from '@/shared/lib/icons/icon-paint-css';
import { ICON_HUE_ROWS } from '@/shared/lib/icons/tint';
import { PAPER_BUCKETS } from '@/shared/lib/icons/icon-tone';
import { ICON_TONES, ICON_TONES_DARK } from '@/shared/lib/icons/tint-hues.generated';

const css = iconPaintStyleSheet();

describe('the paper buckets in the paint stylesheet', () => {
  test('one hue statement per generated row, carrying every bucket and dark', () => {
    for (const { className, hue } of ICON_HUE_ROWS) {
      const tones = PAPER_BUCKETS.map(
        (bucket) => `--icon-tone${bucket === 'deepest' ? '' : `-${bucket}`}: ${ICON_TONES[bucket][hue]};`,
      ).join(' ');
      expect(css).toContain(
        `:where(svg.${className}) { --icon-hue: ${hue}; ${tones} --icon-tone-dark: ${ICON_TONES_DARK[hue]}; }`,
      );
    }
  });

  test('a bucket rule re-points the tone for that paper, and only that paper', () => {
    for (const bucket of PAPER_BUCKETS.filter((name) => name !== 'deepest')) {
      expect(css, bucket).toContain(
        `:where([data-icon-style="color"][data-icon-paper="${bucket}"]) :where(svg.lucide) { --icon-color: var(--icon-tone-${bucket}, var(--icon-color)); }`,
      );
    }
    // `deep` IS `--icon-tone`; a rule for it would be a second statement of the
    // same fact, and the one that could disagree.
    expect(css).not.toContain('data-icon-paper="deepest"');
  });

  test('every bucket rule is gated on the colour mode', () => {
    // Two families: the glyph rule is `:where([data-icon-style="color"]…`, and a
    // PANEL mark rule starts at `:root[…]` because that is the specificity it
    // needs to beat a caller's state class. Both must name the mode.
    const bucketRules = css.split('\n').filter((line) => line.includes('data-icon-paper='));
    expect(bucketRules.length).toBeGreaterThan(0);
    for (const line of bucketRules) expect(line, line.slice(0, 90)).toContain('data-icon-style="color"');
  });
});

describe('a small glyph is drawn heavier', () => {
  test('the 10-14px sizes get a heavier stroke, and only those', () => {
    // At 12px a 2px stroke is barely one pixel of ink. The colour cannot be made
    // brighter to compensate: on `#f1f1f0`, L 0.78 is 1.96:1 — invisible. Ink
    // coverage is the lever that costs no contrast.
    expect(css).toContain(
      'svg.lucide:is([width="10"], [width="11"], [width="12"], [width="13"], [width="14"]) { stroke-width: 2.25; }',
    );
    // The larger sizes keep the library's weight: a 24px glyph does not need it,
    // and a blanket rule would thicken every mark in the app.
    expect(css).not.toMatch(/svg\.lucide\s*\{[^}]*stroke-width/);
  });

  test('the rule is not keyed on the attribute, which cannot distinguish a default', () => {
    // Lucide writes `stroke-width="2"` for a default AND `stroke-width="1.8"` for
    // an explicit prop, so `:not([stroke-width])` matches nothing and a rule
    // built on it is dead code that reads as a working opt-out.
    expect(css).not.toContain(':not([stroke-width])');
  });
});
