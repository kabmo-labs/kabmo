/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Pulling `@font-face` blocks out of a stylesheet, and pointing their `url()`s
 * at the served route.
 *
 * Two callers, one reason to share: the bundler's CSS loader strips faces out
 * of every module it bundles (`lib/bundler/css.ts`) because Bun resolves each
 * local `url()` into base64 or an absolute filesystem path, and the server
 * assembles `/fonts.css` from the same stylesheets
 * (`lib/assets/font-css.server.ts`). The two must agree byte for byte — a face
 * stripped from the bundle has to be the one the stylesheet re-declares, or the
 * font silently never loads.
 *
 * Only a block whose `src` names a LOCAL font moves: a face pointing at a
 * remote url is valid CSS the bundle can keep. `rewriteFontUrls` replaces every
 * local font url with `<FONT_ROUTE_PREFIX><basename>`, which is the only form
 * that survives Bun's loader — a same-origin path is not an escape hatch, since
 * `url("/fonts/x.woff2")` fails the build with "Could not resolve".
 */

import { basename, isAbsolute, resolve as resolvePath } from 'path';

import { FONT_ROUTE_PREFIX } from '@/server/lib/assets/fonts.server';

/** A `url(...)` whose target is a font file. */
const URL_FUNCTION = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
const FONT_FILE = /\.(?:woff2?|ttf|otf)$/i;
/** Schemes Bun leaves alone, and the prefix this module itself emits. */
const EXTERNAL = /^(?:data:|https?:|blob:|\/\/)/i;

/** One `@font-face` block, braces included. Faces cannot nest. */
const FONT_FACE = /@font-face\s*\{[^{}]*\}/g;

/** Absolute path of a local font url, or null when it is not one. */
function localFont(specifier: string, cssDir: string): string | null {
  if (EXTERNAL.test(specifier) || specifier.startsWith(FONT_ROUTE_PREFIX)) return null;
  if (!FONT_FILE.test(specifier)) return null;
  return isAbsolute(specifier) ? specifier : resolvePath(cssDir, specifier);
}

/** Point every font `url()` at the served path. */
export function rewriteFontUrls(css: string, cssDir: string): string {
  return css.replace(URL_FUNCTION, (whole, quote: string, specifier: string) => {
    const absolute = localFont(specifier, cssDir);
    if (!absolute) return whole;
    return `url(${quote}${FONT_ROUTE_PREFIX}${basename(absolute)}${quote})`;
  });
}

/**
 * Split `@font-face` blocks out of a stylesheet.
 *
 * `cssDir` resolves a relative `src` url, so it must be the directory of the
 * file the text came from — not the bundle's.
 */
export function splitFontFaces(css: string, cssDir: string): { rest: string; faces: string[] } {
  const faces: string[] = [];
  const rest = css.replace(FONT_FACE, (block) => {
    const hasLocal = [...block.matchAll(URL_FUNCTION)].some(([, , spec]) => localFont(spec, cssDir));
    if (!hasLocal) return block;
    faces.push(rewriteFontUrls(block, cssDir));
    return '';
  });
  return { rest, faces };
}
