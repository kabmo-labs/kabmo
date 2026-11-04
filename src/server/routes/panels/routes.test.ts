/**
 * @license
 * SPDX-License-Identifier: MIT
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
import { discoverPanelPlugins, getMarketplacePluginsDir, invalidatePanelScan } from '@/server/lib/panels/registry.server';
import { setPluginEnabled } from '@/server/lib/panels/state.server';
import { call, dirs, usePanelRouteFixtures, writePlugin } from '@/server/routes/panels/panel-routes.test-util';

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
