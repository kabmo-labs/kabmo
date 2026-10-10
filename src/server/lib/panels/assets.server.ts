/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The URLs a plugin's served assets are addressed by.
 *
 * Each carries a content hash, and the hash is not decoration: the browser
 * caches an ES module by URL, so a REBUILT plugin imported from the same URL
 * would return the first evaluation and never re-run its `setup`. A changed
 * hash is a changed URL, which is what makes "Rebuild" actually reload the
 * plugin. Every path is relative to the plugin DIRECTORY the URL names, which
 * is the only root the asset route resolves.
 */

import { join } from 'path';
import { findReadme } from '@/server/lib/panels/files.server';

/** The last path segment: the plugin directory name the URL carries. */
export function basenameOf(dir: string): string {
  return dir.split(/[/\\]/).filter(Boolean).pop() ?? '';
}

/** A plugin's bundle URL, carrying the file's content hash. */
export async function bundleUrl(pluginDir: string, app: string): Promise<string> {
  const file = Bun.file(join(pluginDir, app));
  const digest = Bun.hash(await file.arrayBuffer()).toString(36);
  return `/api/panels/bundle/${encodeURIComponent(basenameOf(pluginDir))}.js?v=${digest}`;
}

/**
 * A plugin's stylesheet URL, carrying the file's content hash.
 *
 * Content-addressed for the same reason the bundle is: the client loads this as
 * a `<link rel=stylesheet>`, and a REBUILT plugin whose CSS changed must reach a
 * new URL or the browser would serve the old rules from its cache.
 */
export async function cssUrl(pluginDir: string, css: string): Promise<string> {
  const file = Bun.file(join(pluginDir, css));
  const digest = Bun.hash(await file.arrayBuffer()).toString(36);
  return `/api/panels/css/${encodeURIComponent(basenameOf(pluginDir))}.css?v=${digest}`;
}

/**
 * A plugin's README URL, when it ships one — either the file its manifest names
 * or the `README.md` at its root.
 */
export async function readmeUrlFor(
  pluginDir: string,
  manifest: { readme?: string },
): Promise<{ readmeUrl?: string }> {
  const readme = await findReadme(pluginDir, manifest.readme);
  if (!readme) return {};
  const file = Bun.file(join(pluginDir, readme));
  const digest = Bun.hash(await file.arrayBuffer()).toString(36);
  return {
    readmeUrl: `/api/panels/readme/${encodeURIComponent(basenameOf(pluginDir))}/${readme
      .split('/')
      .map(encodeURIComponent)
      .join('/')}?v=${digest}`,
  };
}

/** A plugin's icon URL, likewise content-addressed. */
export async function iconUrl(pluginDir: string, icon: string): Promise<string> {
  const file = Bun.file(join(pluginDir, icon));
  const digest = Bun.hash(await file.arrayBuffer()).toString(36);
  return `/api/panels/icon/${encodeURIComponent(basenameOf(pluginDir))}/${icon.split('/').map(encodeURIComponent).join('/')}?v=${digest}`;
}
