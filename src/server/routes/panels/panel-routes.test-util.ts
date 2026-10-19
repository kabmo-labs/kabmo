/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Fixtures and lifecycle shared by the panel route suites.
 *
 * The panel routes are exercised from TWO files — the file routes (bundle, icon,
 * README) with the install/catalog verbs, and the install route's server-half
 * sync — and both need the same three things: a marketplace directory of their
 * own, an isolated database, and a plugin-shaped directory on disk. Duplicating
 * them would let the two suites disagree about what "installed" means, and the
 * database isolation is a correctness requirement rather than a convenience
 * (a scan reads the disabled set, so a suite without its own handle writes into
 * the developer's real install).
 *
 * `usePanelRouteFixtures()` registers the `beforeEach`/`afterEach` pair; the
 * functions below are the fixtures a test builds with. The lifecycle is a
 * function rather than a bare import so a suite opts in explicitly, and so the
 * temp directories are created per TEST rather than per process.
 */

import { afterEach, beforeEach } from 'bun:test';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getMarketplacePluginsDir, invalidatePanelScan } from '@/server/lib/panels/registry.server';
import { disposeAllPlugins } from '@/server/lib/plugins/loader.server';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';

/** The default manifest: an app-only plugin. */
export const MANIFEST = { id: 'demo', name: 'Demo', version: '1.0.0', app: 'dist/app.js', icon: 'icon.svg' };

/** The working marketplace root, and the bundled (store) root. */
export const dirs = { root: '', bundled: '' };

/**
 * A plugin directory with a bundle, an icon and a README.
 *
 * `dir` is a marketplace's `plugins/` directory, so the caller chooses whether
 * the copy is the working one or the bundled one.
 */
export function writePlugin(dirName: string, dir: string, manifest: unknown = MANIFEST): string {
  const pluginDir = join(dir, dirName);
  fs.mkdirSync(join(pluginDir, 'dist'), { recursive: true });
  fs.writeFileSync(join(pluginDir, 'kabmo.json'), JSON.stringify(manifest));
  fs.writeFileSync(join(pluginDir, 'dist', 'app.js'), 'export default {};');
  fs.writeFileSync(join(pluginDir, 'icon.svg'), '<svg></svg>');
  fs.writeFileSync(join(pluginDir, 'README.md'), '# Demo\n\nHello.');
  return pluginDir;
}

/**
 * A plugin whose manifest declares a SERVER half, so the loader can run it.
 *
 * The factory registers one RPC method, so "is it loaded?" is answerable by the
 * same registry the routes read — not only by the loader's own map.
 */
export function writeServerPlugin(dirName: string, dir: string): string {
  const manifest = { id: dirName, name: dirName, version: '1.0.0', app: 'dist/app.js', server: 'dist/server.js' };
  const pluginDir = writePlugin(dirName, dir, manifest);
  fs.writeFileSync(
    join(pluginDir, 'dist', 'server.js'),
    'export default function plugin(api) { api.rpc.register("ping", { handler: () => ({ pong: true }) }); }\n',
  );
  return pluginDir;
}

/** Call a loader with path params, as the router would. */
export function call(loader: (args: never) => unknown, params: Record<string, string>) {
  return loader({ params, request: new Request('http://local/') } as never) as Promise<Response>;
}

/** POST a JSON body to an action, as the router would. */
export function post(action: (args: never) => unknown, body: unknown) {
  return action({
    request: new Request('http://local/api/panels/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    params: {},
  } as never) as Promise<Response>;
}

/** The working marketplace's `plugins/` directory. */
export { getMarketplacePluginsDir };

/**
 * Register the per-test lifecycle this fixture set needs.
 *
 * Every assertion here is load-bearing:
 *
 * - the marketplace roots are TEMP directories, or a suite would install into
 *   the checkout's own `marketplace/`;
 * - the database is isolated BEFORE the first scan, because the scan reads the
 *   disabled set and a path set while a cached handle exists is never read —
 *   which is how an earlier version of this suite wrote into the real install;
 * - the loaded plugins are DISPOSED, because the loader's registry is
 *   process-wide and a plugin from one test would still answer in the next;
 * - the load-failure list is cleared, because it is global too and a leftover
 *   entry makes a later "no errors" assertion pass or fail for the wrong reason.
 */
export function usePanelRouteFixtures(): void {
  beforeEach(() => {
    dirs.root = fs.mkdtempSync(join(tmpdir(), 'omc-panel-routes-'));
    dirs.bundled = fs.mkdtempSync(join(tmpdir(), 'omc-panel-store-'));
    process.env.KABMO_MARKETPLACE_DIR = dirs.root;
    process.env.KABMO_BUNDLED_MARKETPLACE_DIR = dirs.bundled;
    isolateDb();
    invalidatePanelScan();
  });

  afterEach(async () => {
    await disposeAllPlugins();
    globalThis.__kabmoPluginLoadErrors = undefined;
    releaseDb();
    delete process.env.KABMO_MARKETPLACE_DIR;
    delete process.env.KABMO_BUNDLED_MARKETPLACE_DIR;
    invalidatePanelScan();
    fs.rmSync(dirs.root, { recursive: true, force: true });
    fs.rmSync(dirs.bundled, { recursive: true, force: true });
  });
}
