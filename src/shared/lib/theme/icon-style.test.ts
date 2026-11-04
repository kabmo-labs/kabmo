/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The icon style's contract.
 *
 * Two facts are pinned here: the default must be what shipped (monochrome ink),
 * and an unreadable stored value must land on it rather than leaving every mark
 * with no rule to paint it.
 */

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_ICON_STYLE,
  ICON_STYLE_ATTRIBUTE,
  ICON_STYLES,
  ICON_STYLE_COPY,
  isIconStyle,
  resolveIconStyle,
} from '@/shared/lib/theme/icon-style';

describe('isIconStyle', () => {
  test('accepts exactly the two styles', () => {
    expect(ICON_STYLES.map(isIconStyle)).toEqual([true, true]);
  });

  test('refuses what another build or a corrupted blob could carry', () => {
    for (const value of ['', 'Color', 'colour', 'full-color', 0, 1, true, null, undefined, {}, ['color']]) {
      expect(isIconStyle(value)).toBe(false);
    }
  });
});

describe('resolveIconStyle', () => {
  test('keeps a style this build draws', () => {
    expect(resolveIconStyle('monochrome')).toBe('monochrome');
    expect(resolveIconStyle('color')).toBe('color');
  });

  test('an unknown value lands on the shipped default, not on undefined', () => {
    expect(resolveIconStyle('vivid')).toBe(DEFAULT_ICON_STYLE);
    expect(resolveIconStyle(undefined)).toBe(DEFAULT_ICON_STYLE);
    expect(resolveIconStyle(null)).toBe(DEFAULT_ICON_STYLE);
  });
});

describe('the style table', () => {
  test('the default is monochrome, which is what every mark shipped as', () => {
    expect(DEFAULT_ICON_STYLE).toBe('monochrome');
    expect(ICON_STYLES).toContain(DEFAULT_ICON_STYLE);
  });

  test('the attribute is a plain `data-` name', () => {
    expect(ICON_STYLE_ATTRIBUTE).toBe('data-icon-style');
  });

  test('every style carries its own label and description', () => {
    const labels = ICON_STYLES.map((style) => ICON_STYLE_COPY[style].label);
    expect(new Set(labels).size).toBe(ICON_STYLES.length);
    for (const style of ICON_STYLES) {
      expect(ICON_STYLE_COPY[style].description.length).toBeGreaterThan(0);
    }
  });

  test('the colour copy names what it colours, so the mode promises no literal hex', () => {
    // Every icon family is covered by the setting; the copy has to say so or a
    // user cannot tell what they just switched on.
    const description = ICON_STYLE_COPY.color.description;
    expect(description).toContain('glyphs');
    expect(description).toContain('brand');
  });
});
