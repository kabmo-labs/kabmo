/**
 * Regenerate `src/shared/lib/markdown/katex-fonts.css` from the installed KaTeX
 * stylesheet, keeping only the woff2 source in every `@font-face`.
 *
 * Upstream lists woff2 → woff → truetype. Browsers download only the first
 * format they support, so the legacy files are never fetched — yet the bundler
 * emits them all (634 kB .woff + 502 kB .ttf). Dropping them shrinks
 * `dist/client/static/font` without changing a single rendered glyph.
 *
 * Run after upgrading `katex`:  bun run scripts/katex-fonts-woff2.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const vendor = join(root, 'node_modules/katex/dist/katex.min.css');
const target = join(root, 'src/shared/lib/markdown/katex-fonts.css');

const HEADER = `/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/*
 * GENERATED — do not edit by hand. Run \`bun run scripts/katex-fonts-woff2.mjs\`
 * after upgrading katex.
 *
 * KaTeX stylesheet, woff2-only. Upstream \`katex/dist/katex.min.css\` lists three
 * sources per @font-face (woff2 -> woff -> truetype); a browser downloads only
 * the first format it supports, so the woff/truetype files were never
 * *requested* while still being emitted into dist/client/static/font
 * (634 kB .woff + 502 kB .ttf). Every src chain below keeps the woff2 source
 * only — the layout rules are byte-identical to upstream.
 *
 * woff2 is supported by Safari 10+, Chrome 36+, Firefox 39+, and Edge 14+;
 * this app targets modern browsers, so the legacy fallbacks buy nothing.
 */
`;

/**
 * Path prefix from `src/shared/lib/markdown/` to the vendored font directory.
 * The source stylesheet relies on `url(fonts/…)` resolving next to itself; the
 * generated file lives in `src/`, so the path has to be explicit. The bundler's
 * CSS loader (`src/server/lib/bundler/css.ts`) resolves these to a served
 * `/fonts/<basename>` url — Bun's own CSS loader would inline them as base64.
 */
const FONT_URL_PREFIX = '../../../../node_modules/katex/dist/fonts/';

const css = readFileSync(vendor, 'utf8')
  .replace(
    /src:url\(fonts\/([^)]+?)\.woff2\) format\("woff2"\),url\(fonts\/[^)]+?\.woff\) format\("woff"\),url\(fonts\/[^)]+?\.ttf\) format\("truetype"\)/g,
    `src:url("${FONT_URL_PREFIX}$1.woff2") format("woff2")`,
  );

const legacy = (css.match(/\.(woff|ttf)\)/g) ?? []).length;
if (legacy > 0) {
  throw new Error(`expected every legacy font source to be stripped, found ${legacy} remaining`);
}

const woff2Count = (css.match(/\.woff2"\)/g) ?? []).length;
if (woff2Count === 0) {
  throw new Error('no woff2 sources matched — katex CSS shape changed, review the pattern');
}

writeFileSync(target, HEADER + css);
console.log(`wrote ${target} (${woff2Count} woff2 sources)`);
