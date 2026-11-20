/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The first frame's `<html>` attributes.
 *
 * The rule worth pinning is the ASYMMETRY: the palette is always written, and
 * the two presentation styles are written only when they are not the style CSS
 * paints with no attribute (`classic` / `monochrome`) — because the client's
 * writers REMOVE the attribute for exactly those values, and a server that
 * emitted `data-surface="classic"` would leave a document the client thinks is
 * "explicitly classic" and a reload flipping between two spellings of the same
 * state. The shipped DEFAULTS (`glass` / `color`) are therefore emitted, so the
 * first frame is already frosted and coloured.
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
  test('the styles CSS paints with no attribute add nothing', () => {
    expect(styleAttributes('classic', 'monochrome')).toBe('');
  });

  test('the shipped defaults are emitted so the first frame is frosted and coloured', () => {
    const defaults = ' data-surface="glass" data-icon-style="color"';
    expect(styleAttributes(undefined, undefined)).toBe(defaults);
    expect(styleAttributes('nonsense', 'nonsense')).toBe(defaults);
    expect(styleAttributes('glass', 'color')).toBe(defaults);
  });

  test('each style contributes its own attribute independently', () => {
    expect(styleAttributes('glass', 'monochrome')).toBe(' data-surface="glass"');
    expect(styleAttributes('classic', 'color')).toBe(' data-icon-style="color"');
    expect(styleAttributes('glass', 'color')).toBe(' data-surface="glass" data-icon-style="color"');
  });

  test('borderless is written, hairline is the absence of the attribute', () => {
    // `hairline` IS what CSS paints with no attribute, so emitting
    // `data-borders="hairline"` would make the served document disagree with
    // the one the client's own writer produces.
    expect(styleAttributes('classic', 'monochrome', undefined, 'hairline')).toBe('');
    expect(styleAttributes('classic', 'monochrome', undefined, 'borderless')).toBe(' data-borders="borderless"');
    expect(styleAttributes('glass', 'color', undefined, 'borderless')).toBe(
      ' data-surface="glass" data-borders="borderless" data-icon-style="color"',
    );
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
  test('writes the palette, the shipped styles and the chrome colour', () => {
    const html = applyShellDocumentFacts(TEMPLATE, {
      palette: light,
      surfaceStyle: undefined,
      borderStyle: undefined,
      iconStyle: undefined,
      chromeColor: '#123456',
    });

    expect(html).toContain(
      `<html lang="en" data-theme="${light.id}" data-surface="glass" data-icon-style="color" data-icon-paper="mid" data-theme-variant="${light.variant}">`,
    );
    expect(html).toContain('<meta name="theme-color" content="#123456" />');
  });

  test('a stored glass style lands on the FIRST frame, not after hydration', () => {
    const html = applyShellDocumentFacts(TEMPLATE, {
      palette: light,
      surfaceStyle: 'glass',
      borderStyle: undefined,
      iconStyle: 'color',
      chromeColor: '#123456',
    });

    expect(html).toContain(
      `<html lang="en" data-theme="${light.id}" data-surface="glass" data-icon-style="color" data-icon-paper="mid" data-theme-variant="${light.variant}">`,
    );
  });

  test('a stored borderless style lands on the FIRST frame too', () => {
    const html = applyShellDocumentFacts(TEMPLATE, {
      palette: light,
      surfaceStyle: undefined,
      borderStyle: 'borderless',
      iconStyle: undefined,
      chromeColor: '#123456',
    });

    expect(html).toContain('data-borders="borderless"');
  });

  test('a document without the template markers is returned untouched, not thrown', () => {
    const stale = '<html><head></head><body>an older build</body></html>';

    expect(
      applyShellDocumentFacts(stale, {
        palette: light,
        surfaceStyle: 'glass',
        borderStyle: undefined,
        iconStyle: 'color',
        chromeColor: '#123456',
      }),
    ).toBe(stale);
  });
});
