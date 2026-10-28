/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `GET /api/panels/icon/:plugin/<path>` — one icon file from a plugin's own
 * directory.
 *
 * The plugin is named by its DIRECTORY and the path is resolved INSIDE that
 * directory, so a request can only ever reach a file an installed plugin ships.
 * A `../` segment is refused even though the manifest that named the icon was
 * already validated — the URL is a second entrance, and it is the one an
 * attacker controls.
 *
 * Images only. A plugin's bundle is served by its own route with the right
 * content type; this one exists so a button can draw a plugin's mark.
 */

import { extname } from 'path';
import { json, type LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { findPluginDir } from '@/server/lib/panels/registry.server';
import { pathExists } from '@/server/lib/omp/core/paths';
import { resolveInsideRoot } from '@/shared/lib/panels/resolve-asset';

const CONTENT_TYPES: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const MAX_ICON_BYTES = 512 * 1024;

export async function loader({ params }: LoaderFunctionArgs) {
  const pluginName = (params.plugin ?? '').trim();
  const rel = (params['*'] ?? '').replace(/^\/+/, '');
  if (!pluginName || /[/\\]/.test(pluginName) || !rel) return json({ error: 'Not found' }, { status: 404 });

  const dir = await findPluginDir(pluginName);
  if (!dir) return json({ error: `Unknown plugin: ${pluginName}` }, { status: 404 });

  const target = resolveInsideRoot(dir, rel);
  if (!target) return json({ error: 'Path escapes the plugin directory' }, { status: 403 });

  const contentType = CONTENT_TYPES[extname(target).toLowerCase()];
  if (!contentType) return json({ error: 'Unsupported icon type' }, { status: 415 });
  if (!(await pathExists(target))) return json({ error: 'Icon not found' }, { status: 404 });

  const file = Bun.file(target);
  if (file.size > MAX_ICON_BYTES) return json({ error: 'Icon is too large' }, { status: 413 });

  return new Response(file, {
    headers: {
      'content-type': contentType,
      // The URL carries a content hash, so a long cache is safe and correct: a
      // changed icon is a changed URL.
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
    },
  });
}
