/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The window-chrome rule, pinned because it has TWO writers (the SSR shell and
 * the client theme writer) and no single call site makes it obvious: the meta
 * tag has to match the surface at the TOP of the window, and that surface is
 * `--theme-paper` on the desktop layout and `--theme-canvas` on the phone and
 * the login screen.
 *
 * The regression this pins: writing `palette.canvas` unconditionally put a
 * strip one step darker than the header beneath it on every desktop install
 * (`#f4f1ea` over `#faf8f3` on the default palette, `#21252b` over `#282c34` on
 * `one-dark-pro-soft`).
 */

import { describe, expect, test } from 'bun:test';

import { windowChromeColor } from '@/shared/lib/theme/chrome';
import { KABMO_PALETTES } from '@/shared/lib/theme/palettes/kabmo';

const paper = KABMO_PALETTES[0];
const oneDark = KABMO_PALETTES[2];

describe('windowChromeColor', () => {
  test('matches the desktop top bar (paper) for an authenticated desktop', () => {
    expect(windowChromeColor(paper, { isMobile: false, authRequired: false })).toBe(paper.paper);
    expect(windowChromeColor(oneDark, { isMobile: false, authRequired: false })).toBe(oneDark.paper);
  });

  test('matches the phone header (canvas) in the mobile layout', () => {
    expect(windowChromeColor(paper, { isMobile: true, authRequired: false })).toBe(paper.canvas);
    expect(windowChromeColor(oneDark, { isMobile: true, authRequired: false })).toBe(oneDark.canvas);
  });

  test('matches the login screen (canvas) in either layout', () => {
    expect(windowChromeColor(paper, { isMobile: false, authRequired: true })).toBe(paper.canvas);
    expect(windowChromeColor(paper, { isMobile: true, authRequired: true })).toBe(paper.canvas);
  });

  test('never returns the ink slot, which is what the manifest carries', () => {
    for (const palette of KABMO_PALETTES) {
      for (const isMobile of [true, false]) {
        for (const authRequired of [true, false]) {
          const chrome = windowChromeColor(palette, { isMobile, authRequired });
          expect([palette.paper, palette.canvas] as string[]).toContain(chrome);
        }
      }
    }
  });
});
