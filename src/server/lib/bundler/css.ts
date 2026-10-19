/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The one CSS loader for every bundler pass Bun runs for this app.
 *
 * Bun's `serve.static` plugins and `Bun.build`'s `plugins` array both feed the
 * client bundle, and both need the same two transforms — so they live in ONE
 * plugin rather than two. `onLoad({ filter: /\.css$/ })` has a single winner per
 * module: whichever plugin returns contents first ends the chain, so two
 * plugins would silently starve each other (Tailwind's `@theme` blocks would
 * survive untouched, or the fonts would keep their unresolvable urls).
 *
 * 1. **Tailwind v4** — `@import "tailwindcss"` and `@theme` are PostCSS syntax,
 *    not CSS. Bun's CSS parser logs `invalid @ rule encountered: '@theme'` and
 *    emits the file verbatim, which costs every utility class in the app. The
 *    project's own `@tailwindcss/postcss` (the same version the previous bundler drove)
 *    expands them here.
 *
 * 2. **`@font-face` extraction** — a font face names a file inside
 *    `node_modules`, and Bun's CSS loader resolves EVERY local `url()`: with the
 *    default `file` loader it inlines the font as base64 (a 592 kB stylesheet,
 *    ~377 kB gzipped, every face downloaded whether or not a formula renders)
 *    and with `dataurl` it writes the ABSOLUTE FILESYSTEM PATH into the CSS. A
 *    same-origin path is not an escape hatch either — `url("/fonts/x.woff2")`
 *    fails the build with "Could not resolve". Measured against Bun 1.4.2: only
 *    `data:`, `http(s):` and protocol-relative urls are left alone, so no
 *    rewrite inside the bundle can work.
 *
 *    The faces therefore leave the bundle. Each block is rewritten to
 *    `<FONT_ROUTE_PREFIX><basename>` and dropped from the module, and the server
 *    re-declares them on `/fonts.css` from the SAME source stylesheets
 *    (`lib/assets/font-css.server.ts`, `lib/assets/font-faces.ts`). The shell
 *    links that route, so the layout rules stay bundled while the faces stay
 *    cacheable files.
 *
 *    The server derives the faces from source rather than from a directory this
 *    plugin wrote, because `onEnd` is NOT invoked by `serve.static` (verified:
 *    `onStart` and `onLoad` fire, `onEnd` never does) and a written artifact is
 *    produced exactly once per process — a `rm -rf` after boot, or a fresh clone
 *    that never built, would leave `/fonts.css` empty for good.
 *
 * 3. **Nested at-rules are flattened** (`flattenNestedAtRules`, registered
 *    AFTER Tailwind so it sees the expanded tree). Bun's CSS minifier keeps the
 *    nesting it is handed and, for `target: 'bun'`, re-nests a rule's nested
 *    at-rule as `@supports (…) { & { … } }` — and Chrome drops a nested rule
 *    whose parent selector names a pseudo-element. Tailwind emits its colour
 *    fallbacks in exactly that shape, so the whole app's placeholder and
 *    scrollbar colours silently collapsed to their fallback. See that module for
 *    the measurement; this one only has to run it.
 */

import { dirname } from 'path';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import type { BunPlugin } from 'bun';

import { splitFontFaces } from '@/server/lib/assets/font-faces';
import { flattenNestedAtRules } from '@/server/lib/bundler/nested-at-rules';

const plugin: BunPlugin = {
  name: 'kabmo-css',
  setup(build) {
    build.onLoad({ filter: /\.css$/ }, async (args) => {
      const source = await Bun.file(args.path).text();
      // Tailwind first: it parses `@import "tailwindcss"` and `@theme`, and the
      // urls it emits are the ones the extraction below has to recognise. The
      // flattener runs after it, because the nesting it removes is Tailwind's
      // own output — and before the font extraction, so a hoisted face is still
      // recognised as a face.
      const expanded = await postcss([tailwind(), flattenNestedAtRules()]).process(source, {
        from: args.path,
      });
      const { rest } = splitFontFaces(expanded.css, dirname(args.path));
      return { contents: rest, loader: 'css' };
    });
  },
};

export default plugin;
