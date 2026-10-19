/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Font files served straight from the installed packages — plus the one the
 * Kabmo vendors itself (`src/shared/lib/fonts`, the Nerd Font symbols face).
 *
 * The client stylesheet reaches its `@font-face` sources through the bundler's
 * CSS loader (`lib/bundler/css.ts`), which rewrites every one of them to
 * `<FONT_ROUTE_PREFIX><basename>`. Nothing is copied at build time: a font is
 * addressed by its own basename, and this module resolves that basename back to
 * the directory that ships it.
 *
 * A directory index rather than a path built from the request, because the
 * request must never choose a directory. The index is built once, lazily, by
 * walking the vendor font directories, and a basename that is not in it is a
 * 404 rather than a lookup somewhere else.
 *
 * The search roots are not just `process.cwd()`. An installed package runs the
 * AOT bundle from `dist/client`, and a `serve --prod` started from another
 * directory has neither `node_modules` nor the source tree under it — so the
 * roots are every directory from the running module up to the filesystem root,
 * plus the cwd. Whichever one holds `node_modules` is the package root.
 */

import { basename, join } from 'path';
import { Glob } from 'bun';

import { searchRoots } from '@/server/lib/fs/package-root';

/** Path prefix every rewritten font url carries. */
export const FONT_ROUTE_PREFIX = '/fonts/';

/** Where the fonts live, relative to a package root. */
const FONT_SOURCES = [
  'node_modules/katex/dist/fonts',
  'node_modules/@fontsource/fira-code/files',
  // The one font Kabmo vendors itself rather than borrowing from a
  // package: the Nerd Font symbols face the terminal falls back to. See
  // `src/shared/lib/fonts/nerd-symbols.css`.
  'src/shared/lib/fonts',
] as const;

/** Basename -> absolute path. Built once; the packages do not change at runtime. */
let index: Record<string, string> | null = null;

async function buildIndex(): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  const glob = new Glob('*.{woff2,woff,ttf,otf}');
  for (const root of searchRoots()) {
    for (const dir of FONT_SOURCES) {
      const from = join(root, dir);
      try {
        for await (const file of glob.scan({ cwd: from, onlyFiles: true })) {
          const name = basename(file);
          // Nearest root wins: a checkout's own node_modules is what its build
          // was made against, so it must not lose to a parent's copy.
          found[name] ??= join(from, file);
        }
      } catch {
        // A root without these packages contributes nothing; the CSS that
        // referenced a missing font will 404, which is the honest outcome.
      }
    }
  }
  return found;
}

/** The font file for a basename, or null when nothing ships it. */
export async function resolveFontFile(name: string): Promise<string | null> {
  // A basename only: a request for `../` or a nested path is not a font.
  if (!name || name !== basename(name)) return null;
  index ??= await buildIndex();
  return index[name] ?? null;
}
