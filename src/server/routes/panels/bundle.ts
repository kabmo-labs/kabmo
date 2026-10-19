/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `GET /api/panels/bundle/:plugin.js` — a plugin's ESM bundle.
 *
 * This is the route that makes an in-process plugin possible: the host imports
 * this URL as a real ES module, so the response must be `text/javascript` with
 * the module's own bytes, unmodified. Nothing is injected and nothing is
 * composed — there is no HTML document to build, because there is no frame.
 *
 * Two rules are load-bearing:
 *
 * - **The plugin is named by its DIRECTORY, and the file comes from the
 *   REGISTRY.** A request can therefore only ever reach a bundle inside an
 *   installed, enabled plugin; the caller never supplies a path. A disabled
 *   plugin has no registry entry and its bundle is a 404, which is what makes
 *   disabling stop the code rather than only hide the button.
 * - **`no-store`.** The URL carries a content hash, so the browser's module
 *   cache is what deduplicates a load — but the HTTP response itself must not be
 *   cached, or a rebuilt plugin would be served from the old bytes under a URL
 *   the registry has already changed.
 */

import { json, type LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { findPluginDir } from '@/server/lib/panels/registry.server';
import { pathExists } from '@/server/lib/omp/core/paths';
import { join } from 'path';

/** Strip a `.js` suffix the route adds for a readable URL. */
function pluginNameOf(param: string | undefined): string {
  const value = (param ?? '').trim();
  return value.endsWith('.js') ? value.slice(0, -3) : value;
}

export async function loader({ params }: LoaderFunctionArgs) {
  const pluginName = pluginNameOf(params.plugin);
  if (!pluginName || /[/\\]/.test(pluginName)) return json({ error: 'Not found' }, { status: 404 });

  const dir = await findPluginDir(pluginName);
  if (!dir) return json({ error: `Unknown plugin: ${pluginName}` }, { status: 404 });

  // The manifest is re-read rather than remembered in the scan: the scan's
  // payload deliberately carries no filesystem paths, and the bundle's location
  // is a property of the plugin, not of the request.
  const manifestPath = join(dir, 'package.json');
  let app = 'dist/app.js';
  if (await pathExists(manifestPath)) {
    const pkg = (await Bun.file(manifestPath).json()) as {
      kabmo?: { app?: unknown };
      ompchamber?: { app?: unknown };
    };
    const declared = pkg.kabmo?.app ?? pkg.ompchamber?.app;
    if (typeof declared === 'string') app = declared;
  }

  const target = join(dir, app);
  if (!(await pathExists(target))) return json({ error: `Bundle not built: ${app}` }, { status: 404 });

  return new Response(Bun.file(target), {
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-store',
      // The bundle is loaded cross-directive from the app's own origin, so a
      // MIME sniff must never turn it into something else.
      'x-content-type-options': 'nosniff',
    },
  });
}
