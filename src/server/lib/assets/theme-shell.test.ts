/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The PWA surfaces that are painted before any of this app's code runs.
 *
 * Three separate reads, one failure mode: a colour baked into the manifest or
 * into a bundled asset cannot follow the theme, and every one of these is a
 * frame the user sees at launch.
 *
 * - `background_color` shipped the brand tile's green (`#0B5D3B`) — the icon's
 *   plate, not a surface — so an installed app launched from a green screen
 *   into a near-black console.
 * - The first frame of a served page is the UA's canvas until the bundle's
 *   stylesheet lands (measured: a white flash on a dark install).
 * - The manifest LINK pointed at a hashed bundled asset, whose body no route
 *   can vary, so a themed manifest needed the link rewritten as well.
 */

import { describe, expect, test } from 'bun:test';

import {
  THEMED_MANIFEST_ROUTE,
  firstFrameStyle,
  manifestColors,
  rewriteManifestLink,
  themedManifest,
} from '@/server/lib/assets/theme-shell.server';
import { KABMO_PALETTES } from '@/shared/lib/theme/palettes/kabmo';
import { DARK_PALETTES } from '@/shared/lib/theme/palettes/dark';

const paper = KABMO_PALETTES[0];
const dark = DARK_PALETTES[0];

const MANIFEST = JSON.stringify({
  name: 'Kabmo',
  background_color: '#0B5D3B',
  theme_color: '#0B5D3B',
  icons: [{ src: '/icon.svg' }],
});

describe('manifestColors', () => {
  test('the install splash is the page ground, not the brand tile', () => {
    expect(manifestColors(paper).background).toBe(paper.canvas);
    expect(manifestColors(paper).background).not.toBe('#0B5D3B');
  });

  test('a dark palette gives a dark splash', () => {
    expect(manifestColors(dark).background).toBe(dark.canvas);
    expect(manifestColors(dark).background).not.toBe(manifestColors(paper).background);
  });
});

describe('themedManifest', () => {
  test('rewrites both colours and keeps everything else', () => {
    const parsed = JSON.parse(themedManifest(MANIFEST, dark)) as Record<string, unknown>;
    expect(parsed.background_color).toBe(dark.canvas);
    expect(parsed.theme_color).toBe(dark.canvas);
    expect(parsed.name).toBe('Kabmo');
    expect(parsed.icons).toEqual([{ src: '/icon.svg' }]);
  });

  test('serves an unparseable manifest unchanged rather than breaking the install', () => {
    // A manifest that will not parse is the file's problem; the install still
    // has to work, so the body is passed through.
    expect(themedManifest('not json', paper)).toBe('not json');
  });

  test('emits JSON a browser accepts', () => {
    expect(() => JSON.parse(themedManifest(MANIFEST, paper))).not.toThrow();
  });
});

describe('firstFrameStyle', () => {
  test('paints html AND body, because either can be the first painted box', () => {
    const css = firstFrameStyle(dark);
    expect(css).toContain('html,body');
    expect(css).toContain(dark.canvas.toLowerCase());
  });

  test('is a plain colour declaration, so no engine has to parse a mix', () => {
    expect(firstFrameStyle(paper)).toBe(`html,body{background-color:${paper.canvas};}`);
  });
});

describe('rewriteManifestLink', () => {
  test('points the shell at the themed route', () => {
    const html = '<link rel="manifest" href="/_dev-assets/asset/c462.webmanifest" />';
    expect(rewriteManifestLink(html)).toBe(`<link rel="manifest" href="${THEMED_MANIFEST_ROUTE}" />`);
  });

  test('leaves a document with no manifest link alone', () => {
    expect(rewriteManifestLink('<html><head></head></html>')).toBe('<html><head></head></html>');
  });
});
