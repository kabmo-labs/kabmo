/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The first frame's `<html>` attributes.
 *
 * The rule worth pinning is the ASYMMETRY: the palette is always written, and
 * the two presentation styles are written only when they are not the default —
 * because the client's writers REMOVE the attribute for the default, and a
 * server that emitted `data-surface="classic"` would leave a document the
 * client thinks is "explicitly classic" and a reload flipping between two
 * spellings of the same state.
 */

import { describe, expect, test } from 'bun:test';
import {
  applyShellDocumentFacts,
  styleAttributes,
} from '@/server/lib/assets/shell-attributes.server';
import { KABMO_PALETTES } from '@/shared/lib/theme/palettes/kabmo';
import { THEMES } from '@/shared/lib/theme/catalog';

const TEMPLATE = `<html lang="en" data-theme="paper" data-theme-variant="light">
  <head>
    <meta name="theme-color" content="#faf8f3" />
  </head>
</html>`;

// `KABMO_PALETTES[0]` is `paper`, which is LIGHT — the earlier name said
// "dark" and every assertion below was written as if a light palette added no
// attributes at all. It does now: its icon paper bucket.
const light = KABMO_PALETTES[0];
const dark = THEMES.find((theme) => theme.variant === 'dark')!;

describe('styleAttributes', () => {
  test('the defaults add nothing at all', () => {
    expect(styleAttributes('classic', 'monochrome')).toBe('');
    expect(styleAttributes(undefined, undefined)).toBe('');
    expect(styleAttributes('nonsense', 'nonsense')).toBe('');
  });

  test('each non-default style contributes its own attribute', () => {
    expect(styleAttributes('glass', 'monochrome')).toBe(' data-surface="glass"');
    expect(styleAttributes('classic', 'color')).toBe(' data-icon-style="color"');
    expect(styleAttributes('glass', 'color')).toBe(' data-surface="glass" data-icon-style="color"');
  });

  test('a light palette carries its icon paper bucket, even at the default styles', () => {
    // Not a preference: without it the first frame paints the `deep` tone table
    // on a `mid` paper, one step darker than the palette allows, and the client's
    // `applyIconPaper` then visibly corrects it.
    expect(styleAttributes('classic', 'monochrome', light)).toBe(' data-icon-paper="mid"');
    // A dark palette has one band, so it states nothing.
    expect(styleAttributes('classic', 'monochrome', dark)).toBe('');
  });
});

describe('applyShellDocumentFacts', () => {
  test('writes the palette and the chrome colour, and nothing else by default', () => {
    const html = applyShellDocumentFacts(TEMPLATE, {
      palette: light,
      surfaceStyle: undefined,
      iconStyle: undefined,
      chromeColor: '#123456',
    });

    expect(html).toContain(
      `<html lang="en" data-theme="${light.id}" data-icon-paper="mid" data-theme-variant="${light.variant}">`,
    );
    expect(html).toContain('<meta name="theme-color" content="#123456" />');
    expect(html).not.toContain('data-surface');
    expect(html).not.toContain('data-icon-style');
  });

  test('a stored glass style lands on the FIRST frame, not after hydration', () => {
    const html = applyShellDocumentFacts(TEMPLATE, {
      palette: light,
      surfaceStyle: 'glass',
      iconStyle: 'color',
      chromeColor: '#123456',
    });

    expect(html).toContain(
      `<html lang="en" data-theme="${light.id}" data-surface="glass" data-icon-style="color" data-icon-paper="mid" data-theme-variant="${light.variant}">`,
    );
  });

  test('a document without the template markers is returned untouched, not thrown', () => {
    const stale = '<html><head></head><body>an older build</body></html>';

    expect(
      applyShellDocumentFacts(stale, {
        palette: light,
        surfaceStyle: 'glass',
        iconStyle: 'color',
        chromeColor: '#123456',
      }),
    ).toBe(stale);
  });
});
