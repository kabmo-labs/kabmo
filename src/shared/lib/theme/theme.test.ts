/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The theme surface `catalog.test.ts` does not already cover: hex arithmetic,
 * the exact CSS the SSR shell inlines, and the structural parity of the three
 * palette sources.
 *
 * Why each case is risky:
 *
 * - `rgbaToHex` feeds xterm, which rejects anything but literal hex. An
 *   out-of-range or unrounded channel emits `#ff0-10`, a color no consumer can
 *   parse, so clamping/rounding is pinned here.
 * - `mixHex` composites the blend's own alpha. A palette that carries 8-digit
 *   alpha (vitesse-dark's `#dbd7caee`) would otherwise be blended as if it were
 *   opaque, darkening every derived shade.
 * - The stylesheet is generated, so a rename of `--theme-*` in `css.ts` would
 *   silently leave every panel reading an undefined variable. The exact block
 *   for `paper` pins both the names and their order.
 * - The three palette files are hand-ported data. A palette missing one of the
 *   twelve fields would paint `undefined` into a CSS declaration; the parity
 *   test fails loudly instead of rendering an invisible swatch.
 */

import { describe, expect, test } from 'bun:test';

import { mixHex, parseHexColor, relativeLuminance, rgbaToHex } from '@/shared/lib/theme/color';
import { THEME_STYLE_ELEMENT_ID, themeStyleSheet } from '@/shared/lib/theme/css';
import { CODE_FILL_PERCENT, MUTED_STEPS, inkScale, onInkTextColor, signalTextColor } from '@/shared/lib/theme/ink-scale';
import { KABMO_PALETTES } from '@/shared/lib/theme/palettes/kabmo';
import { DARK_PALETTES } from '@/shared/lib/theme/palettes/dark';
import { DARK_EXTENDED_PALETTES } from '@/shared/lib/theme/palettes/dark-extended';
import { LIGHT_PALETTES } from '@/shared/lib/theme/palettes/light';
import { LIGHT_EXTENDED_PALETTES } from '@/shared/lib/theme/palettes/light-extended';
import { THEMES } from '@/shared/lib/theme/catalog';

const PALETTE_KEYS = [
  'canvas',
  'error',
  'family',
  'id',
  'info',
  'ink',
  'meta',
  'name',
  'paper',
  'success',
  'variant',
  'warning',
];

describe('hex color parsing', () => {
  test('accepts 3, 6 and 8 digit forms with or without the hash', () => {
    expect(parseHexColor('#abc')).toEqual({ r: 170, g: 187, b: 204, a: 1 });
    expect(parseHexColor('fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseHexColor('  #AABBCC  ')).toEqual({ r: 170, g: 187, b: 204, a: 1 });
    expect(parseHexColor('#aabbccdd')).toEqual({ r: 170, g: 187, b: 204, a: 0xdd / 255 });
  });

  test('splits the 8-digit form as rrggbbaa, not aabbggrr', () => {
    // `#12345678`: r=0x12, g=0x34, b=0x56, a=0x78. A byte-order slip here
    // swaps ink and accent in every alpha-carrying palette.
    const parsed = parseHexColor('#12345678');
    expect(parsed).not.toBeNull();
    expect(parsed?.r).toBe(0x12);
    expect(parsed?.g).toBe(0x34);
    expect(parsed?.b).toBe(0x56);
    expect(parsed?.a).toBeCloseTo(0x78 / 255, 10);
  });

  test('returns null for every notation it does not implement', () => {
    for (const value of ['#1234', '#12345', '#1234567', '#ggg', 'red', 'rgb(0,0,0)', 'color-mix(in srgb, red, blue)', '']) {
      expect(parseHexColor(value)).toBeNull();
    }
  });
});

describe('rgbaToHex', () => {
  test('emits literal lower-case hex', () => {
    expect(rgbaToHex({ r: 0, g: 255, b: 16, a: 1 })).toBe('#00ff10');
  });

  test('clamps out-of-range channels instead of emitting an invalid color', () => {
    // Rounding 127.6 -> 128 -> '80'; the alpha channel is ignored.
    expect(rgbaToHex({ r: 300, g: -5, b: 127.6, a: 0 })).toBe('#ff0080');
  });
});

describe('mixHex', () => {
  test('interpolates from base at ratio 0 to blend at ratio 1', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  test('composites the blend alpha, so a transparent blend changes nothing', () => {
    expect(mixHex('#123456', '#ffffff00', 1)).toBe('#123456');
    // Alpha 0x80 over black at ratio 1 lands on 128/255 of the way to white.
    expect(mixHex('#ffffff', '#00000080', 1)).toBe('#7f7f7f');
  });

  test('falls back to the base when either color cannot be parsed', () => {
    expect(mixHex('not-a-color', '#ffffff', 0.5)).toBe('not-a-color');
    expect(mixHex('#123456', 'not-a-color', 0.5)).toBe('#123456');
  });
});

describe('relativeLuminance', () => {
  test('spans 0 for black to 1 for white', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBe(1);
    expect(relativeLuminance('not-a-color')).toBe(0);
  });

  test('orders a light palette above its dark counterpart', () => {
    expect(relativeLuminance('#f4f1ea')).toBeGreaterThan(relativeLuminance('#21252b'));
  });

  test('ignores the alpha byte, which carries no luminance', () => {
    expect(relativeLuminance('#ffffff00')).toBe(1);
  });
});

describe('generated stylesheet', () => {
  const css = themeStyleSheet();

  test('exports the element id the SSR shell and client both look for', () => {
    expect(THEME_STYLE_ELEMENT_ID).toBe('omp-theme-palettes');
  });

  test('emits the exact variable block for the default palette', () => {
    const paper = KABMO_PALETTES[0];
    const block = [
      `html[data-theme="${paper.id}"] {`,
      `  --theme-paper: ${paper.paper};`,
      `  --theme-canvas: ${paper.canvas};`,
      `  --theme-ink: ${paper.ink};`,
      // The fifteen solved muted steps, stated per palette because an alpha over
      // the ink cannot clear AA on every one (`ink-scale.ts`). One token per
      // step: bucketing them onto four collapsed the ladder.
      ...MUTED_STEPS.map((step, index) => `  --theme-ink-${step}: ${inkScale(paper).ladder[index]};`),
      // The inline-code chip's own opaque fill (never an alpha: see the
      // `--theme-code-fill` rule in `tailwind.css`).
      `  --theme-code-fill: ${inkScale(paper).codeFill};`,
      // Muted text for an inverted surface (`bg-ink`).
      `  --theme-on-ink-muted: ${onInkTextColor(paper)};`,
      `  --theme-muted: ${inkScale(paper).muted};`,
      `  --theme-error: ${paper.error};`,
      `  --theme-success: ${paper.success};`,
      `  --theme-info: ${paper.info};`,
      `  --theme-warning: ${paper.warning};`,
      `  --theme-meta: ${paper.meta};`,
      // The same five as readable text (a status word is text, and the palette
      // hex is chosen for a fill — see `signalTextColor`).
      `  --theme-error-text: ${signalTextColor(paper, 'error')};`,
      `  --theme-success-text: ${signalTextColor(paper, 'success')};`,
      `  --theme-info-text: ${signalTextColor(paper, 'info')};`,
      `  --theme-warning-text: ${signalTextColor(paper, 'warning')};`,
      `  --theme-meta-text: ${signalTextColor(paper, 'meta')};`,
      '  --theme-info-hover: color-mix(in srgb, var(--theme-info) 85%, var(--theme-ink));',
      '  --theme-warning-hover: color-mix(in srgb, var(--theme-warning) 85%, var(--theme-ink));',
      `  color-scheme: ${paper.variant};`,
      '}',
    ].join('\n');
    expect(css).toContain(block);
  });

  test('names every slot --theme-* and nothing else', () => {
    const names = [...css.matchAll(/--theme-[a-z0-9-]+:/g)].map((match) => match[0]);
    // Eight palette slots, fifteen muted steps, the inline-code chip's fill,
    // the inverted-surface level, the palette's own AA level (`--theme-muted`),
    // the five solved signal levels, and the two hover mixes.
    expect(new Set(names).size).toBe(33);
    expect(names[0]).toBe('--theme-paper:');
    // Slot order is the swatch order the appearance cards render.
    expect(names[2]).toBe('--theme-ink:');
    expect(names[3]).toBe('--theme-ink-20:');
    expect(names[17]).toBe('--theme-ink-90:');
    expect(names[18]).toBe('--theme-code-fill:');
    expect(names[19]).toBe('--theme-on-ink-muted:');
    expect(names[20]).toBe('--theme-muted:');
    expect(names[25]).toBe('--theme-meta:');
    expect(names[26]).toBe('--theme-error-text:');
  });

  test('states the inline-code chip fill as an opaque colour, per palette', () => {
    // The chip must NOT be an alpha: a translucent fill composites with whatever
    // is painted behind it, so a hovered block changed the code's colour.
    expect(css).not.toContain('--theme-code-fill: color-mix');
    for (const palette of [KABMO_PALETTES[0], DARK_PALETTES[0]]) {
      const fill = inkScale(palette).codeFill;
      expect(fill).toBe(mixHex(palette.paper, palette.ink, CODE_FILL_PERCENT / 100));
      expect(fill).toMatch(/^#[0-9a-f]{6}$/);
      expect(css).toContain(`--theme-code-fill: ${fill};`);
    }
  });

  test('is cached for the life of the process', () => {
    expect(themeStyleSheet()).toBe(css);
  });
});

describe('palette sources', () => {
  const LIGHT_ALL = [...LIGHT_PALETTES, ...LIGHT_EXTENDED_PALETTES];
  const DARK_ALL = [...DARK_PALETTES, ...DARK_EXTENDED_PALETTES];
  const all = [...KABMO_PALETTES, ...LIGHT_ALL, ...DARK_ALL];

  test('every palette declares the same twelve keys', () => {
    for (const palette of all) {
      expect(Object.keys(palette).sort()).toEqual(PALETTE_KEYS);
    }
  });

  test('every declared value is a non-empty string', () => {
    for (const palette of all) {
      for (const [key, value] of Object.entries(palette)) {
        expect(typeof value, `${palette.id}.${key}`).toBe('string');
        expect((value as string).length, `${palette.id}.${key}`).toBeGreaterThan(0);
      }
    }
  });

  test('each source array carries only its own variant and unique ids', () => {
    const seen = new Set<string>();
    for (const palette of all) {
      expect(seen.has(palette.id), `duplicate id ${palette.id}`).toBe(false);
      seen.add(palette.id);
    }
    for (const palette of LIGHT_ALL) expect(palette.variant).toBe('light');
    for (const palette of DARK_ALL) expect(palette.variant).toBe('dark');
    expect(all.length).toBe(THEMES.length);
  });

  test('the ported families pair up: every light family has a dark twin', () => {
    const light = new Set(LIGHT_ALL.map((palette) => palette.family));
    const dark = new Set(DARK_ALL.map((palette) => palette.family));
    expect(light.size).toBe(LIGHT_ALL.length);
    expect(dark.size).toBe(DARK_ALL.length);
    expect([...light].filter((family) => !dark.has(family))).toEqual([]);
    expect([...dark].filter((family) => !light.has(family))).toEqual([]);
  });
});
