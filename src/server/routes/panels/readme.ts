/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `GET /api/panels/readme/<plugin>/<path>` — a plugin's README, as markdown.
 *
 * A plugin is a repository, and its README is the material a user actually wants
 * before installing: what it does, what it needs, what it writes. Serving it
 * here lets the pane render it in Kabmo's own markdown pipeline (the same
 * sanitizer, Shiki highlighting, KaTeX and mermaid hydration the chat timeline
 * uses) instead of sending the user to a git host.
 *
 * Three rules, and they are the same ones the bundle route follows:
 *
 * - **The plugin is named by its DIRECTORY, and the path is resolved INSIDE it.**
 *   A request can only ever reach a file a plugin ships; a `../` segment is
 *   refused even though the manifest that named the README was already
 *   validated, because the URL is a second entrance and the one a caller
 *   controls.
 * - **Markdown only.** A README is text; anything else is refused by extension
 *   rather than served as an opaque download under a `.md` URL.
 * - **The store is reachable, the working copy wins.** An uninstalled plugin's
 *   README has to be readable — that is the whole point of the button — while an
 *   installed plugin's own copy must win, so the reader shows what is on disk.
 */

import { extname } from 'path';
import { json, type LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { findPluginDir } from '@/server/lib/panels/registry.server';
import { pathExists } from '@/server/lib/omp/core/paths';
import { resolveInsideRoot } from '@/shared/lib/panels/resolve-asset';

/** Markdown, plus the two plain-text spellings a repository might use. */
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdx', '.txt']);

/** How much README is served. A README is prose; a megabyte of it is a fault. */
const MAX_README_BYTES = 512 * 1024;

export async function loader({ params }: LoaderFunctionArgs) {
  const pluginName = (params.plugin ?? '').trim();
  const rel = (params['*'] ?? '').replace(/^\/+/, '');
  if (!pluginName || /[/\\]/.test(pluginName) || !rel) return json({ error: 'Not found' }, { status: 404 });

  if (!MARKDOWN_EXTENSIONS.has(extname(rel).toLowerCase())) {
    return json({ error: 'Only markdown READMEs are served here' }, { status: 415 });
  }

  const dir = await findPluginDir(pluginName);
  if (!dir) return json({ error: `Unknown plugin: ${pluginName}` }, { status: 404 });

  const target = resolveInsideRoot(dir, rel);
  if (!target) return json({ error: 'Path escapes the plugin directory' }, { status: 403 });
  if (!(await pathExists(target))) return json({ error: `README not found: ${rel}` }, { status: 404 });

  const file = Bun.file(target);
  if (file.size > MAX_README_BYTES) return json({ error: 'README is too large to read' }, { status: 413 });

  return new Response(file, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      // Content-addressed URL, so a long cache is safe and correct: an edited
      // README is a changed URL.
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
    },
  });
}
