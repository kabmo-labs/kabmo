/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The editor theme catalogue, and the one property that makes it trustworthy:
 * every colour it ships is the INSTALLED package's own.
 *
 * The grid draws 65 cards without fetching a theme module, so its colours are
 * data. Data generated from a dependency drifts the moment the dependency
 * updates — silently, because the picker still renders, just with a palette the
 * highlighter no longer has. These cases re-derive each row from
 * `@shikijs/themes` itself, which is the only check that can fail on a version
 * bump rather than on a typo.
 *
 * The remaining cases pin the two rules the surfaces depend on: `auto` resolves
 * to no theme (so nothing changes for an install that never opens the picker),
 * and an explicit theme names ITSELF in both Shiki slots — which is what makes
 * the editor ignore the app's light/dark variant without a second CSS path.
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  EDITOR_AUTO_THEME_ID,
  EDITOR_DEFAULT_THEME_ID,
  EDITOR_THEMES,
  EDITOR_THEME_LOADERS,
  editorShikiThemes,
  editorThemeVars,
  isEditorThemeId,
  resolveEditorTheme,
} from '@/shared/lib/code/editor/themes';
import { SHIKI_THEMES } from '@/shared/lib/code/shiki-themes';

/** The installed package's `dist`, resolved through the package itself so a
 *  hoisted or linked install resolves the same way the app's own imports do. */
const THEMES_DIR = join(dirname(Bun.resolveSync('@shikijs/themes/package.json', import.meta.dir)), 'dist');

/** The ids the installed package actually ships, in the generator's order. */
function installedIds(): string[] {
  return readdirSync(THEMES_DIR)
    .filter((file) => file.endsWith('.mjs') && file !== 'index.mjs')
    .map((file) => file.slice(0, -'.mjs'.length))
    .sort();
}

describe('catalogue', () => {
  test('one row per theme the installed package ships, in id order', () => {
    expect(EDITOR_THEMES.map((theme) => theme.id)).toEqual(installedIds());
  });

  test('every row has a loader, and every loader has a row', () => {
    expect(Object.keys(EDITOR_THEME_LOADERS).sort()).toEqual(EDITOR_THEMES.map((theme) => theme.id));
  });

  test('a label is never empty and never the raw id with dashes', () => {
    for (const theme of EDITOR_THEMES) {
      expect(theme.label.length).toBeGreaterThan(0);
      expect(theme.variant === 'light' || theme.variant === 'dark').toBe(true);
    }
  });
});

describe('generated colours', () => {
  test('the surface and the ink are the theme’s own', async () => {
    for (const theme of EDITOR_THEMES) {
      // Dynamic on purpose: the specifier is the row's own id, read at runtime
      // from a 65-entry catalogue — a static import cannot name it.
      const module = (await import(`@shikijs/themes/${theme.id}`)).default as {
        colors?: Record<string, string>;
      };
      const colors = module.colors ?? {};
      expect(theme.bg).toBe(colors['editor.background'] as string);
      // Five themes ship no `editor.foreground`; the generator falls back to the
      // theme's own `foreground`, which is still ITS colour and not a borrow.
      const own =
        colors['editor.foreground'] ?? colors['foreground'] ?? colors['terminal.foreground'] ?? theme.fg;
      expect(theme.fg).toBe(own);
    }
  });

  test('a chrome colour the theme omits is a mix of its own ink and surface', () => {
    for (const theme of EDITOR_THEMES) {
      for (const value of [theme.gutterFg, theme.selection, theme.find, theme.border]) {
        expect(value.length).toBeGreaterThan(0);
        // Either the theme's own hex, or a `color-mix` over its own two colours
        // — never a bare colour borrowed from another theme.
        const isOwnHex = /^#[0-9a-f]{3,8}$/i.test(value);
        const isOwnMix = value.startsWith('color-mix(') && value.includes(theme.bg);
        expect(isOwnHex || isOwnMix).toBe(true);
      }
    }
  });

  test('the three accents differ enough to tell two themes apart', () => {
    for (const theme of EDITOR_THEMES) {
      expect(theme.keyword).toMatch(/^#[0-9a-f]{3,8}$/i);
      expect(theme.string).toMatch(/^#[0-9a-f]{3,8}$/i);
      expect(theme.comment).toMatch(/^#[0-9a-f]{3,8}$/i);
    }
  });
});

describe('resolution', () => {
  test('auto is the default and resolves to no theme', () => {
    expect(EDITOR_DEFAULT_THEME_ID).toBe(EDITOR_AUTO_THEME_ID);
    expect(resolveEditorTheme(EDITOR_AUTO_THEME_ID)).toBeNull();
    expect(resolveEditorTheme(undefined)).toBeNull();
    expect(resolveEditorTheme(null)).toBeNull();
  });

  test('an id this build does not ship falls back to auto rather than half a theme', () => {
    expect(resolveEditorTheme('no-such-theme')).toBeNull();
    expect(isEditorThemeId('no-such-theme')).toBe(false);
  });

  test('a shipped id resolves to its own row', () => {
    const dracula = resolveEditorTheme('dracula');
    expect(dracula?.id).toBe('dracula');
    expect(isEditorThemeId('dracula')).toBe(true);
  });
});

describe('shiki themes', () => {
  test('auto keeps the app’s dual pair, so an app theme flip repaints', () => {
    expect(editorShikiThemes(null)).toEqual(SHIKI_THEMES);
    expect(editorShikiThemes(EDITOR_AUTO_THEME_ID)).toEqual(SHIKI_THEMES);
  });

  test('an explicit theme names itself in BOTH slots', () => {
    // Both slots carrying one theme is what makes the app's variant attribute
    // harmless: `--shiki-light` and `--shiki-dark` hold the same value, so
    // either selector paints the chosen theme.
    expect(editorShikiThemes('dracula')).toEqual({ light: 'dracula', dark: 'dracula' });
  });

  test('an unknown id keeps the app pair', () => {
    expect(editorShikiThemes('no-such-theme')).toEqual(SHIKI_THEMES);
  });
});

describe('css variables', () => {
  test('auto writes nothing, so every declaration keeps its palette fallback', () => {
    expect(editorThemeVars(null)).toEqual({});
  });

  test('an explicit theme writes the surface, the gutter and the diff bands', () => {
    const theme = resolveEditorTheme('nord');
    expect(theme).not.toBeNull();
    const vars = editorThemeVars(theme);
    expect(vars['--editor-bg']).toBe(theme!.bg);
    expect(vars['--editor-fg']).toBe(theme!.fg);
    expect(vars['--editor-gutter-fg']).toBe(theme!.gutterFg);
    expect(vars['--editor-selection']).toBe(theme!.selection);
    expect(vars['--editor-find-current']).toBe(theme!.findCurrent);
    expect(vars['--editor-added']).toBe(theme!.added);
    expect(vars['--editor-removed-gutter']).toBe(theme!.removedGutter);
    // Every key is a custom property, never a plain one.
    for (const key of Object.keys(vars)) expect(key.startsWith('--editor-')).toBe(true);
  });
});
