/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `GET /api/panels/css/:plugin.css` — a plugin's stylesheet, SCOPED.
 *
 * This route exists because a plugin's imported CSS would otherwise be INERT.
 * `Bun.build` emits an imported stylesheet beside the bundle (`dist/app.js`
 * beside `dist/app.css`) and the emitted JS never references it, so the file is
 * built, never fetched, and silently not applied. Declaring `css` in the
 * manifest is what makes the host load it — while the plugin has a live
 * content-script generation, and not otherwise.
 *
 * The file is served WRAPPED in `@scope ([data-plugin-surface="<id>"])`, and
 * that is the load-bearing part. A plugin's CSS lands in the host's document,
 * so unscoped it restyled the app: the demo plugin's `html[data-session-info]
 * .code-block::before` drew a gradient rule over every code block in the chat,
 * because `.code-block` is the HOST's class and `html[…]` is an ancestor of
 * everything. Scoping it to the plugin's own surfaces makes such a selector
 * match nothing, which is the honest outcome — see `scopePluginCss`.
 *
 * Three rules, the same ones the bundle route follows:
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
 * - **The scope id is the MANIFEST id, not the directory name.** The host marks
 *   its surfaces with `manifest.id` (that is what the registry publishes as
 *   `pluginId`), so a scope built from the URL's basename would root at an
 *   attribute no surface carries and the stylesheet would apply to nothing.
 */

import { json, type LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { findPluginDir } from '@/server/lib/panels/registry.server';
import { readPluginManifest } from '@/server/lib/panels/files.server';
import { toManifest } from '@/server/lib/panels/manifest';
import { pathExists } from '@/server/lib/omp/core/paths';
import { scopePluginCss } from '@/shared/lib/panels/css-scope';
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
  // filesystem paths, and the stylesheet's location — and the id the scope is
  // rooted at — are properties of the plugin, not of the request.
  const read = await readPluginManifest(dir);
  if (read.kind !== 'manifest') return json({ error: 'Plugin declares no stylesheet' }, { status: 404 });
  const manifest = toManifest(read.value, dir);
  if ('error' in manifest || !manifest.css) {
    return json({ error: 'Plugin declares no stylesheet' }, { status: 404 });
  }

  const target = join(dir, manifest.css);
  if (!(await pathExists(target))) {
    return json({ error: `Stylesheet not built: ${manifest.css}` }, { status: 404 });
  }

  // Read as TEXT, not streamed as a file: the scope wrapper is a transform, so
  // the bytes served are not the bytes on disk.
  const css = await Bun.file(target).text();
  return new Response(scopePluginCss(css, manifest.id), {
    headers: {
      'content-type': 'text/css; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      // A stylesheet is a MIME-sniffable resource on the app's own origin.
      'x-content-type-options': 'nosniff',
    },
  });
}
