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

const TEMPLATE = `<html lang="en" data-theme="paper" data-theme-variant="light">
  <head>
    <meta name="theme-color" content="#faf8f3" />
  </head>
</html>`;

const dark = KABMO_PALETTES[0];

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
});

describe('applyShellDocumentFacts', () => {
  test('writes the palette and the chrome colour, and nothing else by default', () => {
    const html = applyShellDocumentFacts(TEMPLATE, {
      palette: dark,
      surfaceStyle: undefined,
      iconStyle: undefined,
      chromeColor: '#123456',
    });

    expect(html).toContain(`<html lang="en" data-theme="${dark.id}" data-theme-variant="${dark.variant}">`);
    expect(html).toContain('<meta name="theme-color" content="#123456" />');
    expect(html).not.toContain('data-surface');
    expect(html).not.toContain('data-icon-style');
  });

  test('a stored glass style lands on the FIRST frame, not after hydration', () => {
    const html = applyShellDocumentFacts(TEMPLATE, {
      palette: dark,
      surfaceStyle: 'glass',
      iconStyle: 'color',
      chromeColor: '#123456',
    });

    expect(html).toContain(
      `<html lang="en" data-theme="${dark.id}" data-surface="glass" data-icon-style="color" data-theme-variant="${dark.variant}">`,
    );
  });

  test('a document without the template markers is returned untouched, not thrown', () => {
    const stale = '<html><head></head><body>an older build</body></html>';

    expect(
      applyShellDocumentFacts(stale, {
        palette: dark,
        surfaceStyle: 'glass',
        iconStyle: 'color',
        chromeColor: '#123456',
      }),
    ).toBe(stale);
  });
});
