/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The projection the five native shells paint their launch overlay from.
 *
 * Every case here is a colour a user sees for the seconds before the console
 * paints, and each failure is silent: a wrong `canvas` is a flash of the wrong
 * product, a `muted` that is not the document's own secondary ink makes the
 * status line a different grey from every other muted label, and a shell that
 * cannot parse the answer falls back to the LIGHT palette on a dark install.
 */

import { describe, expect, test } from 'bun:test';

import { THEMES, resolveTheme } from '@/shared/lib/theme/catalog';
import { mixHex, relativeLuminance } from '@/shared/lib/theme/color';
import { MUTED_CONTRAST_FLOOR, inkScale } from '@/shared/lib/theme/ink-scale';
import { KABMO_PALETTES } from '@/shared/lib/theme/palettes/kabmo';
import {
  DEFAULT_SHELL_PALETTE,
  SHELL_PALETTE_PROPERTY,
  parseShellPaletteWire,
  shellPalette,
  shellPaletteFor,
  shellPaletteWire,
} from '@/shared/lib/theme/shell-palette';

const paper = KABMO_PALETTES[0];
const oneDark = KABMO_PALETTES[2];

describe('shellPaletteFor', () => {
  test('paints the page ground, not the raised surface', () => {
    // The overlay covers the window where `body` will paint. `paper` there is a
    // step lighter than the console that replaces it — the seam this exists to
    // remove.
    expect(shellPaletteFor(paper).canvas).toBe(paper.canvas);
    expect(shellPaletteFor(paper).canvas).not.toBe(paper.paper);
  });

  test('carries the variant, so a shell can theme its own chrome', () => {
    expect(shellPaletteFor(paper).variant).toBe('light');
    expect(shellPaletteFor(oneDark).variant).toBe('dark');
  });

  test('derives the two inks from the SAME values the document declares', () => {
    for (const palette of THEMES) {
      const shell = shellPaletteFor(palette);
      // `muted` is the palette's solved secondary text level (`--theme-ink-2`):
      // the shell's status line sits beside the web view's labels, so an alpha
      // that fails AA on a shipped palette would make the sentence vanish there.
      expect(shell.muted, palette.id).toBe(inkScale(palette).muted);
      // `hairline` is a border, not text, and stays the 14% mix.
      expect(shell.hairline, palette.id).toBe(mixHex(palette.canvas, palette.ink, 0.14));
    }
  });

  test('the muted colour clears AA on every palette the shell can paint', () => {
    for (const palette of THEMES) {
      const shell = shellPaletteFor(palette);
      const contrast = (a: string, b: string): number => {
        const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
      };
      // The secondary level's own floor, capped by the palette's own ink: three
      // palettes cannot reach it and their ink IS the ceiling.
      const target = Math.min(MUTED_CONTRAST_FLOOR, contrast(palette.ink, palette.canvas));
      expect(contrast(shell.muted, palette.canvas), palette.id).toBeGreaterThanOrEqual(target - 0.001);
    }
  });

  test('passes the error colour through unchanged', () => {
    expect(shellPaletteFor(paper).error).toBe(paper.error);
    expect(shellPaletteFor(oneDark).error).toBe(oneDark.error);
  });

  test('emits literal hex for every slot, because no shell parses color-mix', () => {
    for (const palette of THEMES) {
      const shell = shellPaletteFor(palette);
      for (const [key, value] of Object.entries(shell)) {
        if (key === 'variant') continue;
        expect(value, `${palette.id}.${key}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  test('a dark palette is actually darker than the light default', () => {
    // The reported bug: an overlay painted #FAF8F3 over a dark console.
    expect(shellPaletteFor(oneDark).canvas).not.toBe(DEFAULT_SHELL_PALETTE.canvas);
  });
});

describe('shellPalette', () => {
  test('resolves a stored id through the catalog', () => {
    expect(shellPalette('one-dark-pro-soft')).toEqual(shellPaletteFor(resolveTheme('one-dark-pro-soft')));
  });

  test('an unknown or absent id is the shipped default, never an unpainted colour', () => {
    for (const id of [undefined, null, '', 'no-such-theme']) {
      expect(shellPalette(id)).toEqual(DEFAULT_SHELL_PALETTE);
    }
  });

  test('the default is the shipped palette projection', () => {
    expect(DEFAULT_SHELL_PALETTE).toEqual(shellPaletteFor(paper));
  });
});

describe('the published property', () => {
  test('is the name every shell hardcodes', () => {
    // Four native shells call this string; a rename here that misses one is a
    // shell that silently keeps painting its stored palette for ever.
    expect(SHELL_PALETTE_PROPERTY).toBe('__kabmoPalette');
  });
});

describe('the wire form', () => {
  test('round-trips every palette in the catalog', () => {
    for (const palette of THEMES) {
      const shell = shellPaletteFor(palette);
      expect(parseShellPaletteWire(shellPaletteWire(shell)), palette.id).toEqual(shell);
    }
  });

  test('is seven pipe-separated fields, nothing to quote or escape', () => {
    const wire = shellPaletteWire(DEFAULT_SHELL_PALETTE);
    expect(wire.split('|')).toHaveLength(7);
    expect(wire).toMatch(/^(light|dark)(\|#[0-9a-f]{6}){6}$/);
  });

  test('refuses a shape a shell must not paint', () => {
    const good = shellPaletteWire(DEFAULT_SHELL_PALETTE);
    for (const bad of [
      '',
      'light',
      good.replace('|#', '|'),
      good.replace(/^light/, 'sepia'),
      good.replace('#', 'rgb('),
      `${good}|extra`,
      null,
      undefined,
    ]) {
      expect(parseShellPaletteWire(bad as string | null | undefined), String(bad)).toBeNull();
    }
  });
});
