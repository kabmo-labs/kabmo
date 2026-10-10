/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `GET /api/panels/css/:plugin.css` — a plugin's stylesheet.
 *
 * This route exists because a plugin's imported CSS would otherwise be INERT.
 * `Bun.build` emits an imported stylesheet beside the bundle (`dist/app.js`
 * beside `dist/app.css`) and the emitted JS never references it, so the file is
 * built, never fetched, and silently not applied. Declaring `css` in the
 * manifest is what makes the host load it — while the plugin has a live
 * content-script generation, and not otherwise.
 *
 * Two rules, the same ones the bundle route follows:
 *
 * - **The plugin is named by its DIRECTORY, and the file comes from the
 *   MANIFEST.** A request can only reach a stylesheet an installed, enabled
 *   plugin declared; the caller never supplies a path. A disabled plugin has no
 *   registry entry and its CSS is a 404, which is what keeps a switched-off
 *   plugin's rules out of the document.
 * - **The URL carries a content hash, so a long cache is correct.** A rebuilt
 *   plugin with changed rules reaches a new URL; the same URL always means the
 *   same bytes. That is the opposite of the bundle's `no-store`, and for the
 *   same underlying reason — the module cache keys on URL, so the URL is what
 *   has to change.
 */

import { json, type LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { findPluginDir } from '@/server/lib/panels/registry.server';
import { pathExists } from '@/server/lib/omp/core/paths';
import { join } from 'path';

/** Strip the `.css` suffix the route adds for a readable URL. */
function pluginNameOf(param: string | undefined): string {
  const value = (param ?? '').trim();
  return value.endsWith('.css') ? value.slice(0, -4) : value;
}

export async function loader({ params }: LoaderFunctionArgs) {
  const pluginName = pluginNameOf(params.plugin);
  if (!pluginName || /[/\\]/.test(pluginName)) return json({ error: 'Not found' }, { status: 404 });

  const dir = await findPluginDir(pluginName);
  if (!dir) return json({ error: `Unknown plugin: ${pluginName}` }, { status: 404 });

  // Re-read rather than remembered in the scan: the scan's payload carries no
  // filesystem paths, and the stylesheet's location is a property of the
  // plugin, not of the request.
  const manifestPath = join(dir, 'package.json');
  let css: string | undefined;
  if (await pathExists(manifestPath)) {
    const pkg = (await Bun.file(manifestPath).json()) as { ompchamber?: { css?: unknown } };
    if (typeof pkg.ompchamber?.css === 'string') css = pkg.ompchamber.css;
  }
  if (!css) return json({ error: 'Plugin declares no stylesheet' }, { status: 404 });

  const target = join(dir, css);
  if (!(await pathExists(target))) return json({ error: `Stylesheet not built: ${css}` }, { status: 404 });

  return new Response(Bun.file(target), {
    headers: {
      'content-type': 'text/css; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      // A stylesheet is a MIME-sniffable resource on the app's own origin.
      'x-content-type-options': 'nosniff',
    },
  });
}
