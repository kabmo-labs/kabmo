/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The catalog is the single source of truth for what Kabmo can paint, and
 * every failure mode here is silent at runtime: an unknown id renders the
 * default palette (a theme that "doesn't work"), a missing color renders as an
 * empty declaration (an invisible swatch, a transparent panel), a wrong variant
 * leaves a dark theme with light scrollbars and light-theme code blocks.
 */

import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_THEME_ID,
  THEMES,
  THEME_SWATCHES,
  isDarkTheme,
  resolveTheme,
  resolveThemeId,
} from '@/shared/lib/theme/catalog';
import { themeStyleSheet } from '@/shared/lib/theme/css';
import { mixHex, parseHexColor } from '@/shared/lib/theme/color';
import { getXtermTheme } from '@/client/data/theme/terminal';

const COLOR_KEYS = ['canvas', 'paper', 'ink', 'error', 'success', 'info', 'warning', 'meta'] as const;
const COLOR_VALUE = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|#[0-9a-f]{8})$/i;

describe('theme catalog', () => {
  test('ships Kabmo palettes plus every ported variant', () => {
    expect(THEMES.length).toBe(45);
    // 21 ported light + paper/contrast; 21 ported dark + one-dark-pro-soft.
    expect(THEMES.filter((t) => t.variant === 'light').length).toBe(23);
    expect(THEMES.filter((t) => t.variant === 'dark').length).toBe(22);
  });

  test('ids are unique and each palette carries a paintable color for every slot', () => {
    const ids = new Set<string>();
    for (const theme of THEMES) {
      expect(ids.has(theme.id)).toBe(false);
      ids.add(theme.id);
      expect(theme.name.length).toBeGreaterThan(0);
      expect(theme.family.length).toBeGreaterThan(0);
      for (const key of COLOR_KEYS) {
        expect(theme[key]).toMatch(COLOR_VALUE);
      }
    }
  });

  test('the default is the shipped E-Ink palette', () => {
    expect(DEFAULT_THEME_ID).toBe('paper');
    expect(resolveTheme(DEFAULT_THEME_ID).name).toBe('E-Ink Paper');
  });

  test('an id the catalog does not know resolves to the default, never to nothing', () => {
    // `noir` shipped until this change as a byte-identical alias of
    // `one-dark-pro-soft`; a settings row naming it must still render.
    for (const unknown of ['noir', 'nonsense', '', undefined, null]) {
      expect(resolveTheme(unknown).id).toBe(DEFAULT_THEME_ID);
      expect(resolveThemeId(unknown)).toBe(DEFAULT_THEME_ID);
    }
  });

  test('every ported family pairs a light entry with a dark one', () => {
    const byFamily = new Map<string, Set<string>>();
    for (const theme of THEMES) {
      const variants = byFamily.get(theme.family) ?? new Set<string>();
      variants.add(theme.variant);
      byFamily.set(theme.family, variants);
    }
    // `paper`/`contrast` (light-only) and `one-dark-pro-soft` (dark-only) are
    // Kabmo's own single-variant palettes; every ported family has both.
    const singles = [...byFamily].filter(([, variants]) => variants.size === 1).map(([family]) => family);
    expect(singles.sort()).toEqual(['contrast', 'one-dark-pro-soft', 'paper']);
  });

  test('swatches name every color the cards can show', () => {
    expect(THEME_SWATCHES.map((s) => s.key)).toEqual([...COLOR_KEYS]);
  });
});

describe('generated stylesheet', () => {
  const css = themeStyleSheet();

  test('defines every palette under a selector that beats :root', () => {
    for (const theme of THEMES) {
      // `html[...]` (0,1,1) outranks the stylesheet's `:root` (0,1,0); a bare
      // `[data-theme]` would tie and lose on document order.
      expect(css).toContain(`html[data-theme="${theme.id}"]`);
    }
    expect(css.match(/html\[data-theme="/g)?.length).toBe(THEMES.length);
  });

  test('carries each palette\'s colors and its color-scheme', () => {
    expect(css).toContain('--theme-canvas: #1F2430;');
    expect(css).toContain('color-scheme: dark;');
    expect(css).toContain('color-scheme: light;');
  });

  test('derives the hover shades instead of pinning a hex that fits one palette', () => {
    expect(css).toContain('--theme-info-hover: color-mix(in srgb, var(--theme-info) 85%, var(--theme-ink));');
  });
});

describe('theme variant verdict', () => {
  test('follows the palette, not a hand-kept id list', () => {
    expect(isDarkTheme('paper')).toBe(false);
    expect(isDarkTheme('one-dark-pro-soft')).toBe(true);
    expect(isDarkTheme('nord-dark')).toBe(true);
    expect(isDarkTheme('nord-light')).toBe(false);
    expect(isDarkTheme('tokyonight-light')).toBe(false);
    expect(isDarkTheme('tokyonight-dark')).toBe(true);
  });

  test('every dark palette is dark and every light palette is not', () => {
    for (const theme of THEMES) {
      expect(isDarkTheme(theme.id)).toBe(theme.variant === 'dark');
    }
  });
});

describe('color math', () => {
  test('parses the notations the ported palettes actually use', () => {
    expect(parseHexColor('#FFF')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseHexColor('#f4f1ea')).toEqual({ r: 244, g: 241, b: 234, a: 1 });
    expect(parseHexColor('#dbd7caee')?.a).toBeCloseTo(0.933, 3);
    expect(parseHexColor('rebeccapurple')).toBeNull();
  });

  test('mixes toward the blend color and composites its alpha', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    // A fully transparent blend leaves the base untouched rather than
    // producing a black hole.
    expect(mixHex('#123456', '#ffffff00', 1)).toBe('#123456');
    expect(mixHex('nonsense', '#ffffff', 1)).toBe('nonsense');
  });
});

describe('terminal palette', () => {
  test('follows the active theme rather than a fixed light/dark pair', () => {
    const nord = getXtermTheme('nord-dark');
    const paper = getXtermTheme('paper');
    expect(nord.background).toBe('#1F2430');
    expect(nord.foreground).toBe('#E5E9F0');
    expect(paper.background).toBe('#f4f1ea');
    expect(paper.foreground).toBe('#141310');
  });

  test('emits literal colors — xterm cannot parse color-mix()', () => {
    for (const theme of THEMES) {
      for (const value of Object.values(getXtermTheme(theme.id))) {
        expect(value).toMatch(COLOR_VALUE);
      }
    }
  });

  test('takes its signal colors from the palette', () => {
    const dracula = getXtermTheme('dracula-dark');
    expect(dracula.red).toBe('#FF5555');
    expect(dracula.green).toBe('#50FA7B');
    expect(dracula.yellow).toBe('#FFB86C');
    expect(dracula.cursor).toBe('#BD93F9');
  });
});
