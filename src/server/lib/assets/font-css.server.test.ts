/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `/fonts.css` is derived from the SOURCE stylesheets on every request, and this
 * is the gate that keeps it that way.
 *
 * The sheet used to be assembled from a directory the bundler wrote as a side
 * effect of bundling a CSS module — so it was produced once per process and
 * could never be repaired. An `rm -rf` while the server ran, or a fresh clone
 * that never built, left the route answering 0 bytes for the rest of that
 * process and the terminal's Nerd symbols face vanished: private-use glyphs
 * became tofu boxes with no error anywhere. These assertions fail if the sheet
 * ever depends on a build artifact again.
 *
 * The last case is the end-to-end one: every font basename the sheet names must
 * resolve to a file the server actually serves. A face pointing at a basename
 * no package ships is a 404 the browser swallows, which looks identical to the
 * font never having been declared.
 */

import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { fontStylesheet, serveFontFile } from '@/server/lib/assets/font-css.server';
import { packageDir } from '@/server/lib/fs/package-root';

const sheet = await fontStylesheet();

/** Every `url(...)` target in the sheet. */
function urls(css: string): string[] {
  return [...css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)].map(([, , target]) => target);
}

describe('/fonts.css is assembled from source, not from a build artifact', () => {
  test('it declares the bundled Nerd symbols face', () => {
    expect(sheet).toContain('Kabmo Nerd Symbols');
    expect(urls(sheet)).toContain('/fonts/symbols-nerd-font-mono.woff2');
    // The range is what keeps the 1.1 MB face off every machine that has a
    // Nerd Font of its own, so a sheet without it is a different contract.
    expect(sheet).toContain('unicode-range');
  });

  test('it declares the text faces the bundle cannot carry', () => {
    expect(sheet).toContain('Fira Code');
    expect(sheet).toContain('KaTeX_Main');
    expect(urls(sheet)).toContain('/fonts/fira-code-latin-400-normal.woff2');
  });

  test('every url is rewritten to the served route — no relative or node_modules path survives', () => {
    const targets = urls(sheet);
    expect(targets.length).toBeGreaterThan(20);
    for (const target of targets) {
      expect(target.startsWith('/fonts/')).toBe(true);
    }
  });

  test('every basename the sheet names resolves to a served file', async () => {
    for (const target of urls(sheet)) {
      const response = await serveFontFile(target.slice('/fonts/'.length));
      expect(response).not.toBeNull();
      expect(response?.headers.get('content-type')).toMatch(/^font\//);
    }
  });
});

describe('the source tree is resolved by the package, not by the dependencies', () => {
  // In a hoisted install the package's own files live under
  // `node_modules/kabmo/` while its dependencies sit in the parent
  // `node_modules/` — so `packageRoot()` (the first root holding
  // `node_modules`) is the PARENT, and looking for `src/` beside the hoisted
  // packages finds nothing. That served an empty sheet and silently dropped
  // every `@font-face`; the stylesheet has to resolve through `packageDir()`.
  test('the stylesheets resolve through packageDir, and it finds the source tree', () => {
    // This repo is a source checkout, where `packageDir()` and `packageRoot()`
    // coincide. The assertion that matters is that the source tree is found AT
    // ALL — the hoisted layout above is the case that breaks, and it cannot be
    // staged from inside the repo without rewriting the module's own search
    // roots, so the end-to-end proof for it lives in the manual run against a
    // simulated published install.
    expect(existsSync(join(packageDir(), 'src'))).toBe(true);
    expect(existsSync(join(packageDir(), 'src', 'shared', 'lib', 'fonts', 'nerd-symbols.css'))).toBe(true);
  });
});
