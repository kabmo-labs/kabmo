/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Why the shell's bundle failed, in the terms the person who broke it needs.
 *
 * Bun renders an HTML route by bundling it. When the bundle fails, the route
 * answers with Bun's own "Build Failed" page, which holds the file, line,
 * message and offending source line — but only inside a JavaScript payload the
 * page decodes at runtime (`Uint8Array.from(atob(…))`, a private binary format
 * with no server-side reader). Scraping that would be a bet on Bun's internals.
 *
 * `Bun.build` is the supported way to the same facts: a probe over the same
 * entrypoint with the same plugins returns `logs` carrying `message` and
 * `position {file,line,column,lineText}`. What it reports is what `Bun.build`
 * rejects, and that set covers every shape the route 500s on — measured against
 * the route on Bun 1.4.2, an unresolved import that survives tree shaking and a
 * syntax error both fail the route and are both reported here. It is not a
 * subset of the route's failures, and deliberately so: a missing named export is
 * answered `200` by the route while Bun serves a 104-byte stub that only calls
 * `location.reload()` in place of the bundle, so the page cannot run. That is a
 * real failure of the bundle and is reported as one.
 *
 * `target: 'browser'` because that is the bundle the page is served; `bun`
 * agreed with it on every case measured.
 *
 * Runs only after the shell has already failed, so its cost lands on a page that
 * is broken anyway and never on a healthy request.
 */

import { join, relative } from 'path';
import type { BuildOutput, BunPlugin } from 'bun';

import { packageDir } from '@/server/lib/fs/package-root';

/** The shell bundle's entrypoint, relative to the package directory. */
const SHELL_ENTRYPOINT = 'index.html';

/** Bun's own config file, and the section naming the bundle's plugins. */
const BUNFIG = 'bunfig.toml';

type BundleLog = BuildOutput['logs'][number];

/**
 * The plugin list Bun uses for this bundle, read from the file Bun reads.
 *
 * The probe has to bundle what the route bundles: a plugin missing here would
 * make it describe a build nobody is served — or succeed where the route fails,
 * which reports nothing at all.
 */
async function bundlePlugins(root: string): Promise<BunPlugin[]> {
  const path = join(root, BUNFIG);
  if (!(await Bun.file(path).exists())) return [];

  let configured: unknown;
  try {
    const config = Bun.TOML.parse(await Bun.file(path).text()) as {
      serve?: { static?: { plugins?: unknown } };
    };
    configured = config.serve?.static?.plugins;
  } catch {
    // A config Bun cannot parse is the build's own error to report.
    return [];
  }
  if (!Array.isArray(configured)) return [];

  const plugins: BunPlugin[] = [];
  for (const entry of configured) {
    if (typeof entry !== 'string') continue;
    // A relative path is resolved from the package root; a bare specifier is
    // left to the resolver, exactly as Bun reads it. Dynamic because the
    // specifier is whatever the config names, not a module known here.
    const specifier = entry.startsWith('.') ? join(root, entry) : entry;
    try {
      const module = (await import(specifier)) as { default?: BunPlugin };
      if (module.default) plugins.push(module.default);
    } catch {
      // Same: an unimportable plugin surfaces through the build, not here.
    }
  }
  return plugins;
}

/**
 * A path as the reader knows it: relative to the package root, falling back to
 * the absolute path when the file is not under it. The fallback matters on
 * macOS, where `tmpdir()` is `/var/…` while the same file resolves to
 * `/private/var/…` — a lexically-relative path there is `../../../private/var/…`,
 * which is longer than what it replaces.
 */
function displayPath(file: string, root: string): string {
  const relativePath = relative(root, file);
  return relativePath && !relativePath.startsWith('..') ? relativePath : file;
}

/** One error as `file:line:column  message` plus the offending source line. */
function formatLog(log: BundleLog, root: string): string {
  const position = log.position;
  if (!position?.file) return log.message;
  const where = `${displayPath(position.file, root)}:${position.line}:${position.column}`;
  const source = position.lineText.trim();
  // The source line travels with the position: a file and column alone still
  // leave the reader hunting for the edit.
  return source ? `${where}  ${log.message}\n    ${source}` : `${where}  ${log.message}`;
}

/**
 * The bundle errors behind a shell that would not render, or null when this
 * build is not the reason (a clean bundle means the failure lies elsewhere).
 *
 * `root` is the PACKAGE, not `packageRoot()`: the entrypoint is `index.html`
 * beside the source, and in a hoisted install the first root holding
 * `node_modules` is the parent, where `index.html` does not exist — so the probe
 * would report no failure at all and the real build error would never be shown.
 */
export async function describeShellBuildFailure(root = packageDir()): Promise<string | null> {
  const entrypoint = join(root, SHELL_ENTRYPOINT);
  if (!(await Bun.file(entrypoint).exists())) return null;

  let result: BuildOutput;
  try {
    result = await Bun.build({
      entrypoints: [entrypoint],
      target: 'browser',
      plugins: await bundlePlugins(root),
      // `throw: false` is what makes the failures readable: it returns them as
      // `logs` instead of rejecting with an AggregateError, and keeps the probe
      // from printing a second copy of an error Bun has already printed.
      throw: false,
    });
  } catch (error) {
    return `Rebuilding the client bundle failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (result.success) return null;

  const errors = result.logs.filter((log) => log.level === 'error');
  if (errors.length === 0) return null;
  return errors.map((log) => formatLog(log, root)).join('\n');
}
