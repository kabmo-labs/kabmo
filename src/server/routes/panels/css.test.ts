/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `GET /api/panels/css/:plugin.css` — the plugin stylesheet route.
 *
 * The route serves the file WRAPPED in `@scope ([data-plugin-surface="<id>"])`,
 * and that wrapper is the whole reason this file exists. A plugin's CSS lands in
 * the host's document, so unscoped it restyled the app: the demo plugin's
 * `html[data-session-info] .code-block::before` drew a gradient rule over every
 * code block in the chat, because `.code-block` is the HOST's class and
 * `html[…]` is an ancestor of everything.
 *
 * The scope's id is the MANIFEST id, not the directory name, because that is
 * what the host marks its surfaces with — a scope rooted at the wrong attribute
 * applies to nothing, which is silent.
 *
 * The other rules are the ones the bundle route follows for the same reasons:
 * the file comes from the manifest (never a request path), and a disabled plugin
 * is unreachable so switching it off stops the bytes.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loader as cssLoader } from '@/server/routes/panels/css';
import { getMarketplacePluginsDir, invalidatePanelScan } from '@/server/lib/panels/registry.server';
import { setPluginEnabled } from '@/server/lib/panels/state.server';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';

const MANIFEST = { id: 'demo', name: 'Demo', version: '1.0.0', app: 'dist/app.js', icon: 'icon.svg' };

let root = '';
let bundled = '';

/** A plugin directory with a bundle, an icon and a README. */
function writePlugin(dirName: string, dir: string, manifest: unknown = MANIFEST): string {
  const pluginDir = join(dir, dirName);
  fs.mkdirSync(join(pluginDir, 'dist'), { recursive: true });
  fs.writeFileSync(join(pluginDir, 'kabmo.json'), JSON.stringify(manifest));
  fs.writeFileSync(join(pluginDir, 'dist', 'app.js'), 'export default {};');
  fs.writeFileSync(join(pluginDir, 'icon.svg'), '<svg></svg>');
  fs.writeFileSync(join(pluginDir, 'README.md'), '# Demo\n\nHello.');
  return pluginDir;
}

/** A plugin whose manifest declares a stylesheet, with the file written. */
function writeCssPlugin(css: string, id = 'demo'): void {
  writePlugin('demo', getMarketplacePluginsDir(), { ...MANIFEST, id, css: 'dist/app.css' });
  fs.writeFileSync(join(getMarketplacePluginsDir(), 'demo', 'dist', 'app.css'), css);
  invalidatePanelScan();
}

/** Call a loader with path params, as the router would. */
function call(loader: (args: never) => unknown, params: Record<string, string>) {
  return loader({ params, request: new Request('http://local/') } as never) as Promise<Response>;
}

beforeEach(async () => {
  root = fs.mkdtempSync(join(tmpdir(), 'omc-panel-css-'));
  bundled = fs.mkdtempSync(join(tmpdir(), 'omc-panel-store-'));
  process.env.KABMO_MARKETPLACE_DIR = root;
  process.env.KABMO_BUNDLED_MARKETPLACE_DIR = bundled;
  // A database of this suite's own, BEFORE the first scan: the scan reads the
  // disabled set, and a path set while a cached handle exists is never read.
  await isolateDb();
  invalidatePanelScan();
});

afterEach(async () => {
  await releaseDb();
  delete process.env.KABMO_MARKETPLACE_DIR;
  delete process.env.KABMO_BUNDLED_MARKETPLACE_DIR;
  invalidatePanelScan();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(bundled, { recursive: true, force: true });
});

describe('the css route', () => {
  test('serves the stylesheet SCOPED to the plugin id', async () => {
    // The fix for the leak: unscoped, the demo plugin's `html[…]
    // .code-block::before` drew a rule over every code block in the chat.
    writeCssPlugin('.badge { color: red; }');

    const response = await call(cssLoader, { plugin: 'demo.css' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/css');

    const body = await response.text();
    expect(body).toContain('@scope ([data-plugin-surface="demo"])');
    expect(body).toContain('.badge { color: red; }');
  });

  test('scopes under the MANIFEST id, not the directory name', async () => {
    // The host marks its surfaces with the manifest id (the registry publishes
    // it as `pluginId`), so a scope built from the URL's basename would root at
    // an attribute no surface carries — the stylesheet would apply to nothing.
    writeCssPlugin('.x { color: red; }', 'other-id');

    const body = await (await call(cssLoader, { plugin: 'demo.css' })).text();
    expect(body).toContain('[data-plugin-surface="other-id"]');
    expect(body).not.toContain('[data-plugin-surface="demo"]');
  });

  test('hoists @import above the scope so it is not discarded', async () => {
    writeCssPlugin('@import url("./other.css");\n.a { color: red; }');

    const body = await (await call(cssLoader, { plugin: 'demo.css' })).text();
    expect(body.indexOf('@import')).toBeLessThan(body.indexOf('@scope'));
  });

  test('404s a plugin that declares no stylesheet', async () => {
    writePlugin('demo', getMarketplacePluginsDir());
    invalidatePanelScan();
    expect((await call(cssLoader, { plugin: 'demo.css' })).status).toBe(404);
  });

  test('404s a declared stylesheet the build did not emit', async () => {
    writePlugin('demo', getMarketplacePluginsDir(), { ...MANIFEST, css: 'dist/app.css' });
    invalidatePanelScan();
    expect((await call(cssLoader, { plugin: 'demo.css' })).status).toBe(404);
  });

  test('404s a disabled plugin, so disabling stops the stylesheet', async () => {
    writeCssPlugin('.a { color: red; }');
    expect((await call(cssLoader, { plugin: 'demo.css' })).status).toBe(200);

    await setPluginEnabled('plugin:demo', false);
    invalidatePanelScan();
    expect((await call(cssLoader, { plugin: 'demo.css' })).status).toBe(404);
  });

  test('refuses a plugin name carrying a path separator', async () => {
    writeCssPlugin('.a { color: red; }');
    expect((await call(cssLoader, { plugin: '../demo.css' })).status).toBe(404);
  });
});
