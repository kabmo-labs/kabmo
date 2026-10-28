/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The font stylesheet, assembled at request time.
 *
 * `@font-face` blocks cannot live in the bundle: Bun's CSS loader resolves every
 * local `url()`, and a font is always a local file — so a bundled face is either
 * a base64 blob or an absolute filesystem path. `lib/bundler/css.ts` lifts each
 * block out of its stylesheet and rewrites the urls to `<FONT_ROUTE_PREFIX><basename>`;
 * this module re-declares them on `/fonts.css`.
 *
 * Two jobs, one route each:
 *
 * - `FONT_STYLESHEET_ROUTE` (`/fonts.css`) concatenates the faces, read from the
 *   source stylesheets under `src/` on every request. It is a handful of
 *   kilobytes and four small files, and reading them is what keeps the sheet
 *   correct for the process's whole life — the alternative, a directory the
 *   bundler wrote, is only ever produced as a side effect of a CSS module being
 *   bundled, so it is written once per process and can never be repaired: an
 *   `rm -rf` while the server runs (or a fresh clone that never ran a build)
 *   leaves `/fonts.css` empty for the rest of that process, and the terminal's
 *   Nerd symbols face silently disappears — the glyphs become tofu boxes with no
 *   error anywhere.
 *
 *   Only a face whose `src` names a local font is re-declared, so a stylesheet
 *   carrying a remote face contributes nothing (see `font-faces.ts`). The faces
 *   the client bundle imports all live under `src/`, which is what makes the
 *   source tree the honest place to read them from: the same files the bundler
 *   strips are the files the browser is served.
 *
 * - `FONT_ROUTE_PREFIX` (`/fonts/<basename>`) serves the file itself from the
 *   installed packages. The basename is the whole key, so the lookup is an index
 *   rather than a path built from the request; see `fonts.server.ts`.
 */

import { dirname, join } from 'path';
import { Glob } from 'bun';

import { splitFontFaces } from '@/server/lib/assets/font-faces';
import { resolveFontFile } from '@/server/lib/assets/fonts.server';
import { packageDir } from '@/server/lib/fs/package-root';

/** The route the assembled stylesheet is served on. */
export const FONT_STYLESHEET_ROUTE = '/fonts.css';

/** Where the stylesheets that carry faces live, relative to the package directory. */
const STYLE_SOURCE_ROOT = 'src';

const FONT_MIME: Record<string, string> = {
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

const STYLESHEET_HEADERS = {
  'content-type': 'text/css; charset=utf-8',
  'cache-control': 'no-store',
} as const;

/** The absolute path of every stylesheet under the package's `src/`, sorted. */
function sourceStylesheets(): string[] {
  const root = join(packageDir(), STYLE_SOURCE_ROOT);
  const glob = new Glob('**/*.css');
  const files: string[] = [];
  try {
    for (const file of glob.scanSync({ cwd: root, onlyFiles: true })) files.push(join(root, file));
  } catch {
    return [];
  }
  // Sorted so the stylesheet is byte-stable between requests: the browser
  // caches on the ETag, and an unstable order would invalidate it for no change.
  files.sort();
  return files;
}

/** Every `@font-face` block the source stylesheets declare, concatenated. */
export async function fontStylesheet(): Promise<string> {
  const parts: string[] = [];
  for (const path of sourceStylesheets()) {
    // A read that fails contributes nothing rather than failing the sheet: the
    // shell links this unconditionally, and one unreadable file must not take
    // the faces beside it down with it.
    const css = await Bun.file(path).text().catch(() => '');
    if (!css) continue;
    const { faces } = splitFontFaces(css, dirname(path));
    if (faces.length > 0) parts.push(...faces);
  }
  return parts.join('\n');
}

/** The `/fonts.css` response. */
export async function serveFontStylesheet(): Promise<Response> {
  return new Response(await fontStylesheet(), { headers: STYLESHEET_HEADERS });
}

/** The `/fonts/<basename>` response, or null when no package ships that file. */
export async function serveFontFile(name: string): Promise<Response | null> {
  const file = await resolveFontFile(name);
  if (!file) return null;
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  return new Response(Bun.file(file), {
    headers: {
      'content-type': FONT_MIME[ext] ?? 'application/octet-stream',
      // A font's bytes never change under a fixed basename inside a pinned
      // dependency, so this is the one asset that can be cached hard.
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}
