/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The brand-colour table's promises: nothing in it is illegible on any palette
 * this build ships, and every row names a glyph that can actually be drawn.
 *
 * Contrast is recomputed from `THEMES`, not from one hardcoded surface — the
 * worst light paper is `tokyonight-light`'s `#dee0ee` and the worst dark one
 * `jetbrains-dark`'s `#2B2D30`, and neither is guessable from the shipped
 * default palette.
 */

import { describe, expect, test } from 'bun:test';
import { BRAND_COLORS, brandColorFor } from '@/shared/lib/models/provider/brand-color';
import { PROVIDER_GLYPHS } from '@/client/components/common/provider-icon/glyphs';
import { THEMES } from '@/shared/lib/theme/catalog';
import {
  BRAND_CONTRAST_FLOOR,
  contrastRatio,
  isNearMonochrome,
  legiblePair,
  worstSurfaceContrast,
} from '@/shared/lib/theme/legibility';

const rows = Object.entries(BRAND_COLORS);
const HEX = /^#[0-9a-f]{6}$/i;

describe('the brand colours', () => {
  test('there are rows to check', () => {
    expect(rows.length).toBeGreaterThan(20);
  });

  test('every light value clears the floor on EVERY light palette', () => {
    for (const [name, entry] of rows) {
      expect(worstSurfaceContrast(entry.light, 'light'), `${name} light ${entry.light}`).toBeGreaterThanOrEqual(
        BRAND_CONTRAST_FLOOR,
      );
    }
  });

  test('every dark value clears the floor on EVERY dark palette', () => {
    for (const [name, entry] of rows) {
      if (entry.dark === null) continue;
      expect(worstSurfaceContrast(entry.dark, 'dark'), `${name} dark ${entry.dark}`).toBeGreaterThanOrEqual(
        BRAND_CONTRAST_FLOOR,
      );
    }
  });

  test('the shipped values are the ones the shared rule derives', () => {
    // One algorithm, not a hand-typed pair: a row that disagreed with
    // `legiblePair` would be a second convention for the same job.
    for (const [name, entry] of rows) {
      expect(entry, name).toEqual({ base: entry.base, ...legiblePair(entry.base) });
    }
  });

  test('a monochrome brand has no dark value, a chromatic one always does', () => {
    for (const [name, entry] of rows) {
      expect(entry.dark === null, `${name} (${entry.base})`).toBe(isNearMonochrome(entry.base));
    }
  });

  test('every value is a 6-digit colour', () => {
    for (const [name, entry] of rows) {
      expect(entry.base, name).toMatch(HEX);
      expect(entry.light, name).toMatch(HEX);
      if (entry.dark !== null) expect(entry.dark, name).toMatch(HEX);
    }
  });

  test('every row names a glyph this build can actually draw', () => {
    for (const name of Object.keys(BRAND_COLORS)) {
      expect(PROVIDER_GLYPHS[name], `${name} has no glyph`).toBeDefined();
    }
  });

  test('a light value is the brand hex or a darker mix of it, never another hue', () => {
    for (const [name, entry] of rows) {
      if (entry.light === entry.base) continue;
      // Mixed toward black: the light value is never brighter than the base.
      expect(contrastRatio(entry.light, '#ffffff'), name).toBeGreaterThanOrEqual(
        contrastRatio(entry.base, '#ffffff'),
      );
    }
  });
});

describe('brandColorFor', () => {
  test('answers the derived pair for each variant', () => {
    // Pinned: these two numbers are what the shared rule produces for Claude,
    // so a change in the mixer shows up here rather than in a screenshot.
    expect(brandColorFor('claude', 'light')).toBe('#b8654a');
    expect(brandColorFor('claude', 'dark')).toBe('#D97757');
  });

  test('a monochrome brand answers null on dark, which the caller paints in ink', () => {
    expect(brandColorFor('openai', 'light')).toBeNull();
    expect(brandColorFor('cursor', 'dark')).toBeNull();
  });

  test('a provider with no row keeps the ink in both modes', () => {
    expect(brandColorFor('my-private-gateway', 'light')).toBeNull();
    expect(brandColorFor(null, 'dark')).toBeNull();
  });
});

describe('the palette the rule measures against', () => {
  test('both variants are represented, so a worst case cannot be vacuous', () => {
    expect(THEMES.some((theme) => theme.variant === 'light')).toBe(true);
    expect(THEMES.some((theme) => theme.variant === 'dark')).toBe(true);
  });
});
