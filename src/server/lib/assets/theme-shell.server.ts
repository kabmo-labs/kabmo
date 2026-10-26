/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The PWA's install splash, and the first frame, painted from the active theme.
 *
 * Two surfaces, one problem: the browser paints BEFORE any of this app's CSS
 * exists.
 *
 * - **The install splash** comes from the manifest's `background_color`, which
 *   shipped the brand tile's green (`#0B5D3B`) — the app icon's plate, not a
 *   surface. On a dark theme that is a green flash into a near-black console.
 * - **The first frame** of a served page is the UA's canvas until the bundle's
 *   stylesheet lands. Measured on a dark install: a white flash for the length
 *   of the CSS request.
 *
 * Both are answered from the palette this server already resolved for the
 * request, so the shell, the manifest and `body` agree.
 *
 * The manifest is served from `public/manifest.webmanifest` — the bundler
 * copies it, and Bun does not rewrite inside a copied JSON file, so its own
 * `background_color`/`theme_color` can only be overridden by serving it.
 */

import { resolve } from 'path';

import { parseHexColor, rgbaToHex } from '@/shared/lib/theme/color';
import { packageDir } from '@/server/lib/fs/package-root';
import type { ThemePalette } from '@/shared/types/theme';

/**
 * The route the themed manifest is served from.
 *
 * `index.html` linked the bundled copy (`./public/manifest.webmanifest`), which
 * the HTML loader resolves into a hashed asset — served by Bun's own table in
 * development and by `plugins/static.ts` in production, neither of which can
 * vary a body per request. A manifest is read by the browser BEFORE any of this
 * app's code runs (that is what its colours are for), so the link is rewritten
 * to this route and the palette is baked in per request.
 */
export const THEMED_MANIFEST_ROUTE = '/manifest.webmanifest';

/** The manifest on disk. Read once: the file is a build artifact. */
let cachedSource: string | null = null;

export async function manifestSource(): Promise<string | null> {
  if (cachedSource !== null) return cachedSource;
  try {
    cachedSource = await Bun.file(resolve(packageDir(), 'public', 'manifest.webmanifest')).text();
    return cachedSource;
  } catch {
    return null;
  }
}

/**
 * Point the shell's manifest link at the themed route.
 *
 * The template links `./public/manifest.webmanifest`, which the HTML loader
 * resolves into a content-hashed asset — a body neither Bun's dev table nor
 * `plugins/static.ts` can vary per request. The manifest's colours are read
 * before this app's code runs, so they have to be the request's palette; a
 * regex over the one `<link rel="manifest">` is the whole rewrite.
 */
export function rewriteManifestLink(html: string): string {
  return html.replace(
    /<link rel="manifest" href="[^"]*"/,
    `<link rel="manifest" href="${THEMED_MANIFEST_ROUTE}"`,
  );
}

/**
 * The manifest's two colours, from a palette.
 *
 * `background_color` is the SPLASH ground, so it is the canvas — the same slot
 * the overlay and `body` paint. `theme_color` styles the browser chrome of an
 * installed app, and the SSR shell already computes it per layout
 * (`shared/lib/theme/chrome.ts`), so this one is only the manifest's fallback
 * for a browser that has not painted a page yet.
 */
export function manifestColors(palette: ThemePalette): { background: string; theme: string } {
  return { background: palette.canvas, theme: palette.canvas };
}

/**
 * The manifest document for a palette, as JSON text.
 *
 * Parsed and re-serialized rather than string-replaced: the file is data, and a
 * regex over JSON is how a colour ends up in the wrong key.
 */
export function themedManifest(source: string, palette: ThemePalette): string {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(source) as Record<string, unknown>;
  } catch {
    // A manifest that will not parse is the file's problem, not this request's:
    // serve it unchanged so the install still works.
    return source;
  }
  const colors = manifestColors(palette);
  parsed.background_color = colors.background;
  parsed.theme_color = colors.theme;
  return JSON.stringify(parsed, null, 2);
}

/**
 * The inline style that paints the first frame.
 *
 * Unlayered on purpose: Tailwind's base layer declares the same values, and an
 * unlayered author rule wins over a layered one — so this cannot lose to the
 * bundle it is standing in for. It carries no `!important`, because the values
 * ARE the document's own and nothing needs overriding once the bundle lands.
 */
export function firstFrameStyle(palette: ThemePalette): string {
  return `html,body{background-color:${rgbaToHex(parseHexColor(palette.canvas) ?? { r: 0, g: 0, b: 0, a: 1 })};}`;
}
