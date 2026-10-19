/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The plugin FILE routes — bundle, icon and README.
 *
 * These three are the security boundary for plugin code and plugin content, and
 * the rules they enforce are exactly the ones a wrong answer makes invisible:
 *
 * - **the plugin is named by its DIRECTORY, and the file is resolved inside it**,
 *   so a crafted `../` cannot turn one plugin's URL into a read of any file the
 *   server can open;
 * - **a disabled plugin is not reachable at all** — that is what makes disabling
 *   stop the code rather than only hide the button;
 * - **the bundled STORE is reachable, the working copy wins**, which is what lets
 *   a card draw the mark and open the README for a plugin that is NOT installed
 *   yet — the whole point of the store button;
 * - **a README is markdown only**, refused by extension rather than served as an
 *   opaque download under a `.md` URL.
 *
 * The traversal cases are exercised against the LOADER rather than over HTTP: a
 * request carrying a literal `../` is normalised by the router before the loader
 * sees it, so a live probe would return the router's 404 and say nothing about
 * whether the guard works.
 */

import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { join } from 'node:path';

import { loader as bundleLoader } from '@/server/routes/panels/bundle';
import { loader as iconLoader } from '@/server/routes/panels/icon';
import { loader as readmeLoader } from '@/server/routes/panels/readme';
import { action as installAction } from '@/server/routes/panels/install';
import { discoverPanelPlugins, getMarketplacePluginsDir, invalidatePanelScan } from '@/server/lib/panels/registry.server';
import { setPluginEnabled } from '@/server/lib/panels/state.server';
import { call, dirs, post, usePanelRouteFixtures, writePlugin } from '@/server/routes/panels/panel-routes.test-util';

usePanelRouteFixtures();

describe('the bundle route', () => {
  test('serves the built module as javascript', async () => {
    writePlugin('demo', getMarketplacePluginsDir());
    invalidatePanelScan();

    const response = await call(bundleLoader, { plugin: 'demo.js' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/javascript');
    expect(await response.text()).toBe('export default {};');
  });

  test('404s an unknown plugin and an unbuilt bundle', async () => {
    expect((await call(bundleLoader, { plugin: 'nope.js' })).status).toBe(404);

    const dir = writePlugin('demo', getMarketplacePluginsDir());
    fs.rmSync(join(dir, 'dist'), { recursive: true, force: true });
    invalidatePanelScan();
    expect((await call(bundleLoader, { plugin: 'demo.js' })).status).toBe(404);
  });

  test('404s a disabled plugin, so disabling stops the code', async () => {
    writePlugin('demo', getMarketplacePluginsDir());
    invalidatePanelScan();
    expect((await call(bundleLoader, { plugin: 'demo.js' })).status).toBe(200);

    await setPluginEnabled('plugin:demo', false);
    invalidatePanelScan();
    expect((await call(bundleLoader, { plugin: 'demo.js' })).status).toBe(404);
  });

  test('refuses a plugin name carrying a path separator', async () => {
    writePlugin('demo', getMarketplacePluginsDir());
    invalidatePanelScan();
    expect((await call(bundleLoader, { plugin: '../demo.js' })).status).toBe(404);
  });
});

describe('the icon route', () => {
  test('serves an image from the plugin directory', async () => {
    writePlugin('demo', getMarketplacePluginsDir());
    invalidatePanelScan();

    const response = await call(iconLoader, { plugin: 'demo', '*': 'icon.svg' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/svg+xml');
  });

  test('refuses a path escaping the plugin directory', async () => {
    writePlugin('demo', getMarketplacePluginsDir());
    invalidatePanelScan();

    // A manifest naming this would already be rejected at scan time; the URL is
    // the second entrance, and the one a caller controls.
    expect((await call(iconLoader, { plugin: 'demo', '*': '../../package.json' })).status).toBe(403);
  });

  test('refuses a non-image by type', async () => {
    writePlugin('demo', getMarketplacePluginsDir());
    invalidatePanelScan();
    expect((await call(iconLoader, { plugin: 'demo', '*': 'README.md' })).status).toBe(415);
  });
});

describe('the README route', () => {
  test('serves markdown as markdown', async () => {
    writePlugin('demo', getMarketplacePluginsDir());
    invalidatePanelScan();

    const response = await call(readmeLoader, { plugin: 'demo', '*': 'README.md' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/markdown');
    expect(await response.text()).toContain('# Demo');
  });

  test('refuses a non-markdown file under a README URL', async () => {
    writePlugin('demo', getMarketplacePluginsDir());
    invalidatePanelScan();

    // Refused by EXTENSION, which is also what stops a traversal from reaching
    // an interesting file: `package.json` is not a README.
    expect((await call(readmeLoader, { plugin: 'demo', '*': 'package.json' })).status).toBe(415);
    expect((await call(readmeLoader, { plugin: 'demo', '*': '../../package.json' })).status).toBe(415);
  });

  test('refuses a markdown path escaping the plugin directory', async () => {
    const pluginDir = writePlugin('demo', getMarketplacePluginsDir());
    // A markdown file OUTSIDE the plugin, which the guard must not reach.
    fs.writeFileSync(join(pluginDir, '..', 'outside.md'), '# secret');
    invalidatePanelScan();

    expect((await call(readmeLoader, { plugin: 'demo', '*': '../outside.md' })).status).toBe(403);
  });

  test('404s a plugin that ships no README', async () => {
    const dir = writePlugin('demo', getMarketplacePluginsDir());
    fs.rmSync(join(dir, 'README.md'));
    invalidatePanelScan();
    expect((await call(readmeLoader, { plugin: 'demo', '*': 'README.md' })).status).toBe(404);
  });
});

describe('the install route', () => {
  test('forget drops a dangling catalog entry and reports the scan without it', async () => {
    // The reported state: the catalog names a directory that is not there, so
    // the scan rejects it and the pane has a dead-end row.
    writePlugin('other', getMarketplacePluginsDir());
    fs.mkdirSync(dirs.root, { recursive: true });
    fs.writeFileSync(
      join(dirs.root, 'marketplace.json'),
      JSON.stringify({
        name: 'Kabmo',
        plugins: [
          { name: 'ghost', source: 'plugins/ghost' },
          { name: 'other', source: 'plugins/other' },
        ],
      }),
    );
    invalidatePanelScan();
    expect((await discoverPanelPlugins()).errors.map((error) => error.source)).toEqual(['plugins/ghost']);

    const response = await post(installAction, { type: 'forget', source: 'plugins/ghost' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; errors: unknown[] };
    expect(body.ok).toBe(true);
    // The whole payload comes back, so the pane clears the row without a second
    // read that could race the write.
    expect(body.errors).toEqual([]);

    const catalog = JSON.parse(fs.readFileSync(join(dirs.root, 'marketplace.json'), 'utf8')) as {
      name: string;
      plugins: Array<{ source: string }>;
    };
    expect(catalog.plugins.map((entry) => entry.source)).toEqual(['plugins/other']);
    expect(catalog.name).toBe('Kabmo');
  });

  test('forget refuses a source that is missing or escapes the marketplace', async () => {
    expect((await post(installAction, { type: 'forget' })).status).toBe(400);
    expect((await post(installAction, { type: 'forget', source: '../../etc' })).status).toBe(400);
  });

  test('forget leaves the directory alone when one is there', async () => {
    // The repair for a MISSING directory must not become a delete: only the
    // remove action may touch files.
    const dir = writePlugin('demo', getMarketplacePluginsDir());
    fs.mkdirSync(dirs.root, { recursive: true });
    fs.writeFileSync(
      join(dirs.root, 'marketplace.json'),
      JSON.stringify({ plugins: [{ name: 'demo', source: 'plugins/demo' }] }),
    );

    expect((await post(installAction, { type: 'forget', source: 'plugins/demo' })).status).toBe(200);
    expect(fs.existsSync(dir)).toBe(true);
    // The plugin still loads — the directory is what makes it exist.
    invalidatePanelScan();
    expect((await discoverPanelPlugins()).plugins.map((plugin) => plugin.pluginId)).toEqual(['demo']);
  });

  test('set_auto_update flips the flag and answers with the payload', async () => {
    const on = await post(installAction, { type: 'set_auto_update', enabled: true });
    expect(on.status).toBe(200);
    const body = (await on.json()) as { ok: boolean; autoUpdate: boolean };
    expect(body.ok).toBe(true);
    expect(body.autoUpdate).toBe(true);

    const off = await post(installAction, { type: 'set_auto_update', enabled: false });
    expect(((await off.json()) as { autoUpdate: boolean }).autoUpdate).toBe(false);
  });

  test('check_updates answers even with nothing to probe', async () => {
    // The button is disabled with no git plugins, but the route must not throw
    // for a stale client that asks anyway.
    writePlugin('demo', getMarketplacePluginsDir());
    invalidatePanelScan();

    const response = await post(installAction, { type: 'check_updates' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; gitStatus: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(body.gitStatus).toEqual({});
  });

  test('update_git refuses a plugin that is not a clone', async () => {
    writePlugin('demo', getMarketplacePluginsDir());
    invalidatePanelScan();

    const response = await post(installAction, { type: 'update_git', pluginId: 'demo' });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain('not a git clone');
  });

  test('update_git requires a plugin id', async () => {
    expect((await post(installAction, { type: 'update_git' })).status).toBe(400);
  });

  test('force_sync refuses a plugin that is not a bundled install', async () => {
    writePlugin('demo', getMarketplacePluginsDir());
    invalidatePanelScan();

    const response = await post(installAction, { type: 'force_sync', pluginId: 'demo' });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain('No bundled plugin');
  });

  test('force_sync requires a plugin id', async () => {
    expect((await post(installAction, { type: 'force_sync' })).status).toBe(400);
  });

  test('the payload carries an empty syncBlocked by default', async () => {
    writePlugin('demo', getMarketplacePluginsDir());
    invalidatePanelScan();
    // The field is always present, so the pane's notice has one shape to read
    // rather than two (absent versus empty).
    expect((await discoverPanelPlugins()).syncBlocked).toEqual({});
  });
});

describe('the bundled store is reachable', () => {
  test('an uninstalled store plugin serves its icon and README', async () => {
    // The store card has to draw the mark and open the details BEFORE the plugin
    // is installed — that is the entire purpose of the button.
    writePlugin('offer', join(dirs.bundled, 'plugins'));
    invalidatePanelScan();

    const payload = await discoverPanelPlugins();
    expect(payload.panels).toEqual([]);
    expect(payload.catalog.map((entry) => entry.pluginId)).toEqual(['demo']);
    expect(payload.catalog[0].iconUrl).toContain('/api/panels/icon/offer/icon.svg');
    expect(payload.catalog[0].readmeUrl).toContain('/api/panels/readme/offer/README.md');

    expect((await call(iconLoader, { plugin: 'offer', '*': 'icon.svg' })).status).toBe(200);
    expect((await call(readmeLoader, { plugin: 'offer', '*': 'README.md' })).status).toBe(200);
  });

  test('the WORKING copy wins when a plugin exists in both', async () => {
    // Otherwise an installed plugin would keep showing the shipped icon after the
    // user replaced it.
    writePlugin('demo', join(dirs.bundled, 'plugins'));
    fs.writeFileSync(join(dirs.bundled, 'plugins', 'demo', 'README.md'), '# From the store');

    const installed = writePlugin('demo', getMarketplacePluginsDir());
    fs.writeFileSync(join(installed, 'README.md'), '# From the working copy');
    invalidatePanelScan();

    const response = await call(readmeLoader, { plugin: 'demo', '*': 'README.md' });
    expect(await response.text()).toContain('From the working copy');
  });
});
