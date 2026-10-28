/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Hex color arithmetic for the terminal palette.
 *
 * xterm cannot parse `color-mix()`, so blends are computed here and handed over
 * as literal hex — a wrong blend is a wrong-looking terminal, and a wrong
 * fallback (returning a broken string instead of the base color) would blank a
 * palette entry. The parser must handle all three spellings the ported palettes
 * use (`#rgb`, `#rrggbb`, and 8-digit `#rrggbbaa`, including OpenChamber's
 * `#FFF`), and `mixHex` must composite the blend's own alpha rather than treat
 * it as opaque. `relativeLuminance` orders palette colors light-to-dark.
 */

import { describe, expect, test } from 'bun:test';

import { mixHex, parseHexColor, relativeLuminance, rgbaToHex } from '@/shared/lib/theme/color';

describe('parseHexColor', () => {
  test('parses the short form, with or without the hash', () => {
    expect(parseHexColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseHexColor('fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseHexColor('#abc')).toEqual({ r: 170, g: 187, b: 204, a: 1 });
  });

  test('parses the long form, case-insensitively and trimmed', () => {
    expect(parseHexColor('#1A2b3C')).toEqual({ r: 26, g: 43, b: 60, a: 1 });
    expect(parseHexColor('  #1a2b3c  ')).toEqual({ r: 26, g: 43, b: 60, a: 1 });
  });

  test('parses 8-digit values as r/g/b plus an alpha fraction', () => {
    expect(parseHexColor('#11223344')).toEqual({ r: 0x11, g: 0x22, b: 0x33, a: 0x44 / 255 });
    expect(parseHexColor('#aabbccff')).toEqual({ r: 170, g: 187, b: 204, a: 1 });
  });

  test('returns null for anything that is not 3, 6 or 8 hex digits', () => {
    expect(parseHexColor('')).toBeNull();
    expect(parseHexColor('red')).toBeNull();
    expect(parseHexColor('#ffff')).toBeNull();
    expect(parseHexColor('#fffff')).toBeNull();
    expect(parseHexColor('#1234567')).toBeNull();
    expect(parseHexColor('#gggggg')).toBeNull();
    expect(parseHexColor('rgb(1,2,3)')).toBeNull();
  });
});

describe('rgbaToHex', () => {
  test('renders six lowercase hex digits, ignoring alpha', () => {
    expect(rgbaToHex({ r: 255, g: 255, b: 255, a: 1 })).toBe('#ffffff');
    expect(rgbaToHex({ r: 0, g: 0, b: 0, a: 0.2 })).toBe('#000000');
  });

  test('rounds and clamps each channel', () => {
    expect(rgbaToHex({ r: 300, g: -5, b: 127.6, a: 1 })).toBe('#ff0080');
    expect(rgbaToHex({ r: 127.4, g: 0, b: 0, a: 1 })).toBe('#7f0000');
  });
});

describe('mixHex', () => {
  test('ratio 0 is the base and ratio 1 the opaque blend', () => {
    expect(mixHex('#ffffff', '#000000', 0)).toBe('#ffffff');
    expect(mixHex('#ffffff', '#000000', 1)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  test('composites the blend alpha into the weight', () => {
    expect(mixHex('#ffffff', '#00000080', 1)).toBe('#7f7f7f');
    expect(mixHex('#ffffff', '#00000080', 0.5)).toBe('#bfbfbf');
  });

  test('falls back to the base when either side cannot be parsed', () => {
    expect(mixHex('nope', '#fff', 0.5)).toBe('nope');
    expect(mixHex('#000', 'nope', 0.5)).toBe('#000');
  });
});

describe('relativeLuminance', () => {
  test('is 0 for black and 1 for white', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBe(1);
  });

  test('weights green above red above blue', () => {
    expect(relativeLuminance('#ff0000')).toBeCloseTo(0.2126, 6);
    expect(relativeLuminance('#00ff00')).toBeCloseTo(0.7152, 6);
    expect(relativeLuminance('#0000ff')).toBeCloseTo(0.0722, 6);
  });

  test('uses the linear segment for very dark colors', () => {
    expect(relativeLuminance('#0a0a0a')).toBeCloseTo(0.0030353, 5);
    expect(relativeLuminance('#0a0a0a')).toBeLessThan(relativeLuminance('#808080'));
  });

  test('orders colors light-to-dark and treats unparseable input as black', () => {
    expect(relativeLuminance('#ffffff')).toBeGreaterThan(relativeLuminance('#808080'));
    expect(relativeLuminance('#808080')).toBeGreaterThan(relativeLuminance('#000000'));
    expect(relativeLuminance('nope')).toBe(0);
  });
});
