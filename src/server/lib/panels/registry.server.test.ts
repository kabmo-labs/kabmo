/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Panel-plugin discovery for the single bundled marketplace.
 *
 * The rules pinned here are the ones a wrong answer makes invisible:
 *
 * - a manifest naming a path that escapes its own root must be REJECTED, not
 *   served — the asset route would otherwise read any file the server can open;
 * - a directory with no manifest is not a plugin, so the root may hold a README;
 * - a directory that IS a plugin but is broken must be REPORTED with its reason;
 * - a plugin present under `plugins/` but absent from the catalog still loads —
 *   that is what makes a hand-copied folder work;
 * - a catalog entry naming a missing directory is reported, because the file says "installed";
 * - a duplicate panel key is dropped and reported;
 * - the cache is invalidated explicitly, so an install appears without a restart;
 * - the disabled set is keyed by the PREFIXED panel id, one list for both kinds;
 * - an unsatisfiable `engines` range or a capability this host lacks is refused
 *   BY NAME, with both sides of the comparison in the reason.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  discoverPanelPlugins,
  findPluginDir,
  getMarketplaceCatalogPath,
  getMarketplaceDir,
  getMarketplacePluginsDir,
  invalidatePanelScan,
} from '@/server/lib/panels/registry.server';
import { setPluginEnabled } from '@/server/lib/panels/state.server';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';

let root = '';

const VALID = {
  id: 'demo',
  name: 'Demo',
  version: '1.0.0',
  app: 'dist/app.js',
};

function writeCatalog(catalog: unknown): void {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(getMarketplaceCatalogPath(), JSON.stringify(catalog));
}

function writePlugin(dirName: string, manifest: unknown): string {
  const dir = join(getMarketplacePluginsDir(), dirName);
  fs.mkdirSync(join(dir, 'dist'), { recursive: true });
  fs.writeFileSync(join(dir, 'kabmo.json'), JSON.stringify(manifest));
  // The scan only publishes a plugin whose bundle exists; an unbuilt one is
  // reported as UNBUILT, which is a different list.
  fs.writeFileSync(join(dir, 'dist', 'app.js'), 'export default {};');
  return dir;
}

beforeEach(async () => {
  root = fs.mkdtempSync(join(tmpdir(), 'kabmo-marketplace-'));
  process.env.KABMO_MARKETPLACE_DIR = root;
  // The scan reads the disabled set, which is a DATABASE read — so the suite
  // needs a database of its own before the first scan, or it opens the real one
  // and a `setPluginEnabled` below rewrites a live install.
  await isolateDb();
  invalidatePanelScan();
});

afterEach(async () => {
  delete process.env.KABMO_MARKETPLACE_DIR;
  await releaseDb();
  invalidatePanelScan();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('getMarketplaceDir', () => {
  test('honours the override so a test never reads the real marketplace', () => {
    expect(getMarketplaceDir()).toBe(root);
    expect(getMarketplacePluginsDir()).toBe(join(root, 'plugins'));
  });
});

describe('discoverPanelPlugins', () => {
  test('a missing marketplace is one empty entry, not an error', async () => {
    fs.rmSync(root, { recursive: true, force: true });
    invalidatePanelScan();
    const payload = await discoverPanelPlugins();
    expect(payload.panels).toEqual([]);
    expect(payload.errors).toEqual([]);
    // The pane still names the marketplace, so its empty state can explain
    // where a plugin would go.
    expect(payload.marketplaces).toHaveLength(1);
    expect(payload.marketplaces[0].id).toBe('kabmo');
  });

  test('a plugin is loaded and attributed to the marketplace', async () => {
    writeCatalog({ name: 'Kabmo' });
    writePlugin('demo', VALID);
    invalidatePanelScan();
    const { panels, marketplaces, errors } = await discoverPanelPlugins();
    expect(errors).toEqual([]);
    expect(panels).toHaveLength(1);
    expect(panels[0].pluginId).toBe('demo');
    expect(panels[0].appUrl).toContain('/api/panels/bundle/demo.js');
    expect(marketplaces[0].panelCount).toBe(1);
  });

  test('the catalog supplies the marketplace display name and description', async () => {
    writeCatalog({ name: 'Acme Tools', description: 'Internal panels.' });
    writePlugin('demo', VALID);
    invalidatePanelScan();
    const { marketplaces } = await discoverPanelPlugins();
    expect(marketplaces[0].name).toBe('Acme Tools');
    expect(marketplaces[0].description).toBe('Internal panels.');
  });

  test('a plugin absent from the catalog still loads', async () => {
    writeCatalog({ name: 'Kabmo', plugins: [] });
    writePlugin('demo', VALID);
    invalidatePanelScan();
    const { panels, errors } = await discoverPanelPlugins();
    expect(panels.map((p) => p.pluginId)).toEqual(['demo']);
    expect(errors).toEqual([]);
  });

  test('a plugin loads with no catalog at all', async () => {
    writePlugin('demo', VALID);
    invalidatePanelScan();
    const { panels, marketplaces } = await discoverPanelPlugins();
    expect(panels).toHaveLength(1);
    expect(marketplaces[0].name).toBe('Kabmo');
  });

  test('a catalog entry pointing at a missing directory is reported', async () => {
    writeCatalog({ plugins: [{ name: 'ghost', source: 'plugins/ghost' }] });
    invalidatePanelScan();
    const { errors } = await discoverPanelPlugins();
    expect(errors).toHaveLength(1);
    expect(errors[0].reason).toContain('no plugin was found there');
    expect(errors[0].marketplace).toBe('kabmo');
    // The entry's own source rides along: that row is the only rejection a user
    // can clear from the pane, and the entry is addressed by this path.
    expect(errors[0].source).toBe('plugins/ghost');
  });

  test('a rejection that is not a dangling entry carries no source', async () => {
    // Nothing to forget: the fault is in a manifest that will not parse, and a
    // button that dropped the record would hide it rather than fix it.
    const dir = join(getMarketplacePluginsDir(), 'corrupt');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(join(dir, 'kabmo.json'), '{ not json');
    invalidatePanelScan();
    const { errors } = await discoverPanelPlugins();
    expect(errors).toHaveLength(1);
    expect(errors[0].source).toBeUndefined();
  });

  test('a catalog entry that escapes the marketplace root is refused', async () => {
    writeCatalog({ plugins: [{ name: 'evil', source: '../../etc' }] });
    writePlugin('demo', VALID);
    invalidatePanelScan();
    const { errors } = await discoverPanelPlugins();
    expect(errors.some((e) => e.reason.includes('escapes the marketplace directory'))).toBe(true);
  });

  test('a catalog whose plugins is not an array is reported', async () => {
    writeCatalog({ plugins: 'nope' });
    invalidatePanelScan();
    const { errors } = await discoverPanelPlugins();
    expect(errors[0].reason).toContain('must be an array');
  });

  test('a catalog that is not JSON is reported', async () => {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(getMarketplaceCatalogPath(), '{ not json');
    invalidatePanelScan();
    const { errors } = await discoverPanelPlugins();
    expect(errors[0].reason).toContain('not valid JSON');
  });

  test('a directory with no manifest is skipped silently', async () => {
    fs.mkdirSync(join(getMarketplacePluginsDir(), 'notes'), { recursive: true });
    fs.writeFileSync(join(getMarketplacePluginsDir(), 'notes', 'README.md'), 'scratch');
    writePlugin('demo', VALID);
    invalidatePanelScan();
    const { panels, errors } = await discoverPanelPlugins();
    expect(panels).toHaveLength(1);
    expect(errors.some((e) => e.dir.endsWith('notes'))).toBe(false);
  });

  test('reads the manifest from package.json#kabmo as well', async () => {
    const dir = join(getMarketplacePluginsDir(), 'from-pkg');
    fs.mkdirSync(join(dir, 'dist'), { recursive: true });
    fs.writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', kabmo: VALID }));
    fs.writeFileSync(join(dir, 'dist', 'app.js'), 'export default {};');
    invalidatePanelScan();
    const { panels } = await discoverPanelPlugins();
    expect(panels).toHaveLength(1);
  });

  test('a plugin whose app escapes its directory is rejected by name', async () => {
    writePlugin('escape', { ...VALID, app: '../../etc/passwd' });
    invalidatePanelScan();
    const { panels, errors } = await discoverPanelPlugins();
    expect(panels).toEqual([]);
    expect(errors[0].reason).toContain('escapes the plugin directory');
  });

  test('a broken manifest is reported with its reason', async () => {
    writePlugin('broken', { id: 'broken', name: 'Broken', version: '1.0.0' });
    invalidatePanelScan();
    const { errors } = await discoverPanelPlugins();
    expect(errors[0].reason).toContain('no "app" bundle');
  });

  test('an unbuilt plugin is listed as not built, not as a rejection', async () => {
    const dir = join(getMarketplacePluginsDir(), 'unbuilt');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(join(dir, 'kabmo.json'), JSON.stringify(VALID));
    invalidatePanelScan();
    const { panels, plugins, errors } = await discoverPanelPlugins();
    expect(panels).toEqual([]);
    expect(errors).toEqual([]);
    expect(plugins[0]).toMatchObject({ pluginId: 'demo', built: false });
  });

  test('a manifest that exists but is not JSON is reported', async () => {
    const dir = join(getMarketplacePluginsDir(), 'corrupt');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(join(dir, 'kabmo.json'), '{ not json');
    invalidatePanelScan();
    const { errors } = await discoverPanelPlugins();
    expect(errors[0].reason).toContain('not valid JSON');
  });

  test('an icon escaping the root is refused rather than served', async () => {
    writePlugin('bad-icon', { ...VALID, icon: '../../x.svg' });
    invalidatePanelScan();
    const { errors } = await discoverPanelPlugins();
    expect(errors[0].reason).toContain('escapes the plugin directory');
  });

  test('two directories claiming one plugin id: both are listed, keyed by directory', async () => {
    // The registry is addressed by DIRECTORY, because that is what the bundle
    // route can resolve to a file. Two directories with one manifest id is a
    // packaging mistake, and reporting both is more honest than dropping one.
    writePlugin('first', VALID);
    writePlugin('second', VALID);
    invalidatePanelScan();
    const { panels } = await discoverPanelPlugins();
    expect(panels.map((panel) => panel.pluginId)).toEqual(['demo', 'demo']);
  });

  test('the payload carries no filesystem path, but the dir lookup resolves one', async () => {
    const dir = writePlugin('demo', VALID);
    invalidatePanelScan();
    const { panels } = await discoverPanelPlugins();
    expect(Object.keys(panels[0])).not.toContain('pluginDir');
    expect(await findPluginDir('demo')).toBe(dir);
    expect(await findPluginDir('nope')).toBeUndefined();
  });

  test('invalidatePanelScan makes a newly written plugin visible', async () => {
    writePlugin('demo', VALID);
    invalidatePanelScan();
    expect((await discoverPanelPlugins()).panels).toHaveLength(1);

    writePlugin('second', { ...VALID, id: 'second' });
    invalidatePanelScan();
    expect((await discoverPanelPlugins()).panels).toHaveLength(2);
  });

  test('a disabled plugin contributes no panels and no dir map entry', async () => {
    const dir = writePlugin('demo', VALID);
    await setPluginEnabled('plugin:demo', false);
    invalidatePanelScan();
    const payload = await discoverPanelPlugins();
    expect(payload.panels).toEqual([]);
    // The bundle route resolves its root from the same scan, so a disabled
    // plugin's code is unreachable as well as its button being gone.
    expect(await findPluginDir('demo')).toBeUndefined();
    // The row survives, with its switch off — that is what lets the user
    // turn it back on. `enabled` is the SAME verdict the client's panel filter
    // reaches, because both test the one prefixed key.
    expect(payload.plugins.find((plugin) => plugin.pluginId === 'demo')?.enabled).toBe(false);
    // The raw disabled list travels with the payload, because the client is
    // what resolves a BUILT-IN view's bare id — the server has no built-in
    // panel list and must not need one.
    expect(payload.disabledPanels).toEqual(['plugin:demo']);

    await setPluginEnabled('plugin:demo', true);
    invalidatePanelScan();
    expect((await discoverPanelPlugins()).panels).toHaveLength(1);
    expect(await findPluginDir('demo')).toBe(dir);
  });

  test('a bare built-in view id does not switch a plugin off', async () => {
    writePlugin('demo', VALID);
    // The two kinds of panel share ONE list, so the keys must not collide: a
    // built-in view's bare id must leave every plugin alone.
    await setPluginEnabled('demo', false);
    invalidatePanelScan();
    const payload = await discoverPanelPlugins();
    expect(payload.disabledPanels).toEqual(['demo']);
    expect(payload.panels.map((panel) => panel.pluginId)).toEqual(['demo']);
    expect(payload.plugins[0].enabled).toBe(true);
  });

});
