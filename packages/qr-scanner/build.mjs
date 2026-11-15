/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Builds `qr-scanner.html` from `page.html` by inlining jsQR.
 *
 * WHY A GENERATED FILE: the page is one document for three hosts (Android,
 * Windows, Linux), and the decoder it needs is 131 KB of minified JavaScript
 * that no one should hand-edit. `page.html` is the source; this script bundles
 * `jsqr` from `node_modules` into an IIFE that assigns `globalThis.jsQR` and
 * splices it into the page's `<script id="jsqr">` block.
 *
 * WHY jsQR AT ALL: `BarcodeDetector` exists only where the OS has a barcode
 * provider — Android WebView 83+, and Chromium on macOS/ChromeOS. WebView2 on
 * Windows has none (Chromium hides the interface on platforms with no provider
 * since M88, crbug 40725008) and WebKitGTK has none, so a page that relied on it
 * alone decoded nothing on Windows.
 *
 * Usage:
 *   bun packages/qr-scanner/build.mjs           # write qr-scanner.html
 *   bun packages/qr-scanner/build.mjs --check   # fail when it is stale
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, 'page.html');
const target = join(here, 'qr-scanner.html');
const OPEN = '<script id="jsqr">';
const CLOSE = '</script>';

/**
 * The bundle, as an IIFE that leaves `window.jsQR` behind.
 *
 * The entry lives in a temp directory INSIDE this package: `Bun.build` resolves
 * `jsqr` by walking up from the entry, and a temp directory outside the repo
 * would not find `node_modules`.
 */
async function bundle() {
  const dir = mkdtempSync(join(here, '.jsqr-'));
  const entry = join(dir, 'entry.js');
  writeFileSync(entry, "import jsQR from 'jsqr';\nglobalThis.jsQR = jsQR;\n");
  try {
    const out = await Bun.build({
      entrypoints: [entry],
      target: 'browser',
      format: 'iife',
      minify: true,
    });
    if (!out.success) throw new Error(out.logs.map(String).join('\n'));
    return (await out.outputs[0].text()).trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const page = readFileSync(source, 'utf8');
const start = page.indexOf(OPEN);
const end = page.indexOf(CLOSE, start);
if (start < 0 || end < 0) {
  throw new Error(`${source} has no ${OPEN} … ${CLOSE} block to fill`);
}

const html = `${page.slice(0, start + OPEN.length)}\n${await bundle()}\n${page.slice(end)}`;

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(target, 'utf8');
  } catch {
    // Missing is stale.
  }
  if (current !== html) {
    console.error(
      'packages/qr-scanner/qr-scanner.html is stale — run `bun packages/qr-scanner/build.mjs`.',
    );
    process.exit(1);
  }
  console.log('packages/qr-scanner/qr-scanner.html is current.');
} else {
  writeFileSync(target, html);
  console.log(`wrote ${target} (${html.length} bytes)`);
}
