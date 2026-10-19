/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The two bundles a plugin can be built into, and where their sources come from.
 *
 * Split out of `build.server.ts` because the two targets differ in almost
 * everything the bundler is told — `target`, the plugins list, and whether the
 * shared runtime is shimmed — while the orchestration around them (install,
 * link, verify) is identical. Keeping them in one function meant every reader
 * had to hold both shapes at once.
 *
 * The targets are NOT symmetric, and the asymmetry is the point:
 *
 * - **The app bundle runs in the BROWSER**, so it is shimmed: `preact` and the
 *   SDK resolve to the host's `globalThis.__ompchamberPluginRuntime`, which is
 *   what keeps one Preact instance across the host and every plugin.
 * - **The server bundle runs in BUN, in the chamber's own process**, so there is
 *   nothing to shim — no runtime global is published there. It bundles
 *   everything it imports, `@kabmo-labs/plugin-sdk` included: the entry is
 *   imported by absolute path from the plugin's directory, and a self-contained
 *   file cannot fail to resolve a dependency at load time.
 */

import { join } from 'path';
import type { BunPlugin } from 'bun';
import { pathExists } from '@/server/lib/omp/core/paths';
import { runtimeShimPlugin } from '@/server/lib/panels/shim';

/**
 * The source file the browser bundle is built from.
 *
 * The manifest names the OUTPUT (`dist/app.js`), so the source has to come from
 * a convention. `src/app.tsx` is the documented one; the root-level fallbacks
 * cover a hand-written plugin that has no `src/`.
 */
export const APP_SOURCE_CANDIDATES = ['src/app.tsx', 'src/app.ts', 'app.tsx', 'app.ts'];

/** The source file a plugin's server half is built from. */
export const SERVER_SOURCE_CANDIDATES = ['src/server.ts', 'src/server.tsx', 'server.ts'];

/** The first candidate that exists under `root`, or null. */
export async function findSource(root: string, candidates: readonly string[]): Promise<string | null> {
  for (const candidate of candidates) {
    if (await pathExists(join(root, candidate))) return candidate;
  }
  return null;
}

/** One build's outcome: `error` carries the line a pane can render. */
export type BundleOutcome = { ok: true } | { ok: false; error: unknown };

/**
 * Bundle a browser-side entry, with the shared runtime rewritten to the host's.
 *
 * Naming is fixed rather than hashed: the manifest names the output, and the
 * bundle route adds a content hash to the URL so a rebuilt plugin is re-imported
 * instead of being served from the browser's module cache.
 */
export async function buildAppBundle(root: string, source: string, outdir: string): Promise<BundleOutcome> {
  return runBuild({
    entrypoints: [join(root, source)],
    target: 'browser',
    format: 'esm',
    minify: true,
    naming: '[dir]/[name].[ext]',
    outdir,
    plugins: [runtimeShimPlugin()],
  });
}

/**
 * Bundle a server entry for Bun.
 *
 * Not minified: this half runs in the chamber's own process, where a stack
 * trace naming a real function is worth more than the bytes, and it is loaded
 * once per boot rather than served to a browser on every page load.
 */
export async function buildServerBundle(root: string, source: string, outdir: string): Promise<BundleOutcome> {
  return runBuild({
    entrypoints: [join(root, source)],
    target: 'bun',
    format: 'esm',
    minify: false,
    naming: '[dir]/[name].[ext]',
    outdir,
  });
}

/**
 * Run one `Bun.build`, normalizing the two failure shapes.
 *
 * An UNRESOLVABLE import THROWS rather than answering `success: false`
 * (measured on Bun 1.4.2), and the thrown error is the only place the specifier
 * that could not be found appears — so a caller that only checked `success`
 * would lose the one message the author needs.
 */
async function runBuild(options: Parameters<typeof Bun.build>[0] & { plugins?: BunPlugin[] }): Promise<BundleOutcome> {
  try {
    const result = await Bun.build(options);
    return result.success ? { ok: true } : { ok: false, error: result.logs };
  } catch (error) {
    return { ok: false, error };
  }
}
