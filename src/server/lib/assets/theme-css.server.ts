/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two generated stylesheets, served as one immutable asset.
 *
 * `themeStyleSheet` (68.9 KB) and `iconPaintStyleSheet` (113.2 KB) are built
 * from TS tables, so the bundler cannot carry them — but they are FIXED for the
 * life of a build, which is what makes them a cacheable file rather than 182 KB
 * of inline `<style>` in every document. Measured before this module: a
 * navigation carried 187,419 characters of HTML, 182,093 of them these two
 * sheets, and the shell is `no-store`, so every navigation paid for them again.
 *
 * The URL carries a content hash and the response is `immutable`: a browser
 * fetches it once per build and never asks again. The hash is computed from the
 * bytes, so a palette or icon-table edit changes the URL and cannot be served
 * from a stale cache.
 *
 * Order is load-bearing and matches the inline order it replaces: the palette
 * rules first, then the icon paint. The icon sheet declares Tailwind's full
 * `@layer` order, and it must be parsed before the bundled stylesheet — a
 * `<link>` in `<head>` before the bundle's own link keeps that true.
 */

import { iconPaintStyleSheet } from '@/shared/lib/icons/icon-paint-css';
import { themeStyleSheet } from '@/shared/lib/theme/css';
import { maybeCompress } from '@/server/plugins/compress';

/** The bytes, built once. Both generators are already memoized. */
const BODY = `${themeStyleSheet()}\n${iconPaintStyleSheet()}\n`;

/** Content hash, so a changed sheet is a changed URL. */
const HASH = Bun.hash(BODY).toString(36);

/** Where the shell links this sheet. */
export const THEME_CSS_ROUTE = `/theme-${HASH}.css`;

const HEADERS = {
  'content-type': 'text/css; charset=utf-8',
  // Content-addressed: the URL changes with the bytes, so it can never be stale.
  'cache-control': 'public, max-age=31536000, immutable',
} as const;

/** The sheet, compressed for the client that asked. */
export function serveThemeCss(request: Request): Promise<Response> {
  return maybeCompress(
    new Response(BODY, { headers: HEADERS }),
    request.headers.get('accept-encoding'),
  );
}
