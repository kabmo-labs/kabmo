/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Production build: the client bundle and the server bundle, separately.
 *
 * **Two builds, not one, and the reason is code splitting.** The client is a
 * single ~13.4 MB entry when the two are built together, because a build that
 * also carries the server cannot split without publishing server chunks into
 * `dist/client/static/` — a path `plugins/static.ts` serves to anyone. Measured:
 * `splitting: true` on that combined build emitted 325 chunks, 67-98 of which
 * were the server's own.
 *
 * So the client is built from `index.html` with `splitting: true` (1.84 MB boot
 * chunk, 586 KB gzip, versus 13.4 MB / 3.26 MB gzip), and the server is built
 * from `src/server/index.ts` with `splitting: false` and `*.html` external —
 * production reads the built shell from disk instead of importing the HTML
 * bundle (`lib/lifecycle/shell-entry.server.ts`).
 *
 * **`Bun.build`, not `bun build`.** The CLI does NOT read `bunfig.toml`'s
 * `[serve.static]` plugins (verified: `bun build --target=bun --production`
 * emitted Tailwind's `@theme` verbatim and a stylesheet with zero utility
 * classes), so the CSS plugin has to be passed explicitly — and the JS API is
 * the only place that is possible.
 *
 * **The outdir is the package root, not a subdirectory**: the generated server
 * resolves its asset paths against the cwd, and `serve --prod` runs from the
 * root (the SQLite file, the workspace roots, `public/`). Naming is set
 * explicitly because the default would look for `./chunk-*.js` beside the
 * executable.
 */

import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import cssPlugin from '@/server/lib/bundler/css';

const ROOT = join(import.meta.dir, '..');
const OUTDIR = ROOT;
const PREFIX = 'dist/client';
/** Source bytes below which a split chunk is folded into a shared one. */
const MIN_CHUNK_SIZE = 16_384;

process.chdir(ROOT);

const started = performance.now();
// A stale bundle is worse than a slow build: the output directory is replaced,
// not merged, so a chunk this build no longer emits cannot survive in it.
await rm(join(ROOT, PREFIX), { recursive: true, force: true });

async function run(name: string, options: Parameters<typeof Bun.build>[0]): Promise<void> {
  const at = performance.now();
  const result = await Bun.build({ ...options, outdir: OUTDIR, target: 'bun' });
  for (const log of result.logs) console.log(`[build:${name}] ${log.level}: ${log.message}`);
  if (!result.success) throw new Error(`the ${name} bundle failed`);
  const bytes = await Promise.all(result.outputs.map(async (output) => (await output.arrayBuffer()).byteLength));
  const total = bytes.reduce((sum, size) => sum + size, 0);
  console.log(
    `[build:${name}] ${result.outputs.length} files, ${(total / 1048576).toFixed(2)} MB`
    + ` in ${((performance.now() - at) / 1000).toFixed(2)}s`,
  );
}

try {
  // 1. The client: `index.html` is the entrypoint, so every lazily imported
  //    grammar, theme and viewer becomes a chunk fetched when it is first used.
  await run('client', {
    entrypoints: [join(ROOT, 'index.html')],
    minify: true,
    splitting: true,
    minChunkSize: MIN_CHUNK_SIZE,
    plugins: [cssPlugin],
    naming: {
      entry: `${PREFIX}/[name].[ext]`,
      chunk: `${PREFIX}/static/js/[name]-[hash].[ext]`,
      asset: `${PREFIX}/static/[name]-[hash].[ext]`,
    },
  });

  // 2. The server: one file. It is what `script/build.js` and the CLI run from
  //    `dist/client/index.js`, and it reads the shell the first build wrote.
  //    `*.html` stays external — the dev-only branch that imports it resolves
  //    through Bun at runtime, and production never takes it.
  await run('server', {
    entrypoints: [join(ROOT, 'src', 'server', 'index.ts')],
    minify: true,
    splitting: false,
    external: ['*.html'],
    naming: {
      entry: `${PREFIX}/[name].[ext]`,
      chunk: `${PREFIX}/[name]-[hash].[ext]`,
      asset: `${PREFIX}/[name]-[hash].[ext]`,
    },
  });
} catch (error) {
  console.error(`[build] failed in ${((performance.now() - started) / 1000).toFixed(2)}s`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

console.log(`[build] done in ${((performance.now() - started) / 1000).toFixed(2)}s -> ${PREFIX}`);
// The `@font-face` blocks are NOT part of the bundle and no artifact is written
// for them: the plugin strips them out and the server re-declares them on
// `/fonts.css` from the source stylesheets under `src/`, per request. Nothing to
// report here.
