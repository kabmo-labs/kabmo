/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Production build for the client bundle.
 *
 * The server bundles HTML routes itself in production (`development: false`
 * caches the result in memory), so this script exists for the two things that
 * need a build up front: the published tarball, which must carry the assets
 * `serve --prod` serves, and CI, which should fail on a bundle error rather
 * than at a user's first request.
 *
 * `Bun.build` rather than `bun build` on purpose. The CLI does NOT read
 * `bunfig.toml`'s `[serve.static]` plugins (verified: `bun build --target=bun
 * --production` emitted Tailwind's `@theme` verbatim and a stylesheet with zero
 * utility classes), so the plugin has to be passed explicitly — and the JS API
 * is the only place that is possible.
 *
 * The entrypoints are the SERVER, not `index.html`: the server is what imports
 * the HTML, and bundling it is what makes Bun emit the HTML plus its hashed JS,
 * CSS and assets into `outdir`. `naming` is set because the generated server
 * resolves its asset paths relative to the process cwd — with the default
 * naming the bundle looks for `./chunk-*.js` beside the executable, which only
 * holds if it is run from `outdir`.
 */

import { rm } from 'fs/promises';
import { join } from 'path';

import cssPlugin from '@/server/lib/bundler/css';

const ROOT = join(import.meta.dir, '..');
// Built INTO the package root, not into a subdirectory, so the generated
// server resolves its assets while the process runs from the root — the cwd
// every other part of the app depends on (the SQLite file, the workspace
// roots, `public/`). Bun resolves an HTML bundle's asset paths against the cwd,
// so an outdir of `dist/client` would force `serve --prod` to run from there
// and silently relocate the database to `dist/client/workspace.db`.
const OUTDIR = ROOT;
const PREFIX = 'dist/client';

process.chdir(ROOT);

const started = performance.now();
// A stale bundle is worse than a slow build: the output directory is replaced,
// not merged, so a chunk this build no longer emits cannot survive in it.
await rm(join(ROOT, PREFIX), { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [join(ROOT, 'src', 'server', 'index.ts')],
  outdir: OUTDIR,
  target: 'bun',
  minify: true,
  plugins: [cssPlugin],
  naming: {
    entry: `${PREFIX}/[name].[ext]`,
    chunk: `${PREFIX}/static/js/[name]-[hash].[ext]`,
    asset: `${PREFIX}/static/[name]-[hash].[ext]`,
  },
});

for (const log of result.logs) console.log(`[build] ${log.level}: ${log.message}`);

if (!result.success) {
  console.error(`[build] failed in ${((performance.now() - started) / 1000).toFixed(2)}s`);
  process.exit(1);
}

const bytes = await Promise.all(result.outputs.map(async (output) => (await output.arrayBuffer()).byteLength));
const total = bytes.reduce((sum, size) => sum + size, 0);
console.log(
  `[build] ${result.outputs.length} files, ${(total / 1048576).toFixed(2)} MB`
  + ` in ${((performance.now() - started) / 1000).toFixed(2)}s -> ${PREFIX}`,
);
// The `@font-face` blocks are NOT part of the bundle and no artifact is written
// for them: the plugin strips them out and the server re-declares them on
// `/fonts.css` from the source stylesheets under `src/`, per request. Nothing to
// report here.
