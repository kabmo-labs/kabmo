/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Removing an installed plugin, and the catalog entry that goes with it.
 *
 * Split from the install suite because the two own different contracts: an
 * install stages, validates and builds before it registers, while a remove is
 * the one action that DELETES files and therefore has to say exactly what it
 * deletes and what it leaves. The rule that matters is that the directory and
 * the catalog entry go together — dropping only the directory left the catalog
 * naming a path that no longer existed, so every removal produced a permanent
 * "listed in marketplace.json but no plugin was found there" row, the pane
 * showing the user's own successful action as a fault.
 *
 * The second rule is that a catalog which could not be pruned is reported. The
 * directory is gone either way, so the removal SUCCEEDED; reporting it as a
 * failure would leave the user believing the plugin is still installed, while
 * silence would leave the leftover entry unexplained.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { discoverPanelPlugins, getMarketplaceCatalogPath, invalidatePanelScan } from '@/server/lib/panels/registry.server';
import { removePanelPlugin } from '@/server/lib/panels/install.server';

let root = '';

const VALID = { id: 'demo', name: 'Demo', version: '1.0.0', app: 'dist/app.js' };

/** A plugin directory with a manifest and a built bundle. */
function writePlugin(id: string): void {
  const dir = join(root, 'plugins', id);
  fs.mkdirSync(join(dir, 'dist'), { recursive: true });
  fs.writeFileSync(join(dir, 'kabmo.json'), JSON.stringify({ ...VALID, id }));
  fs.writeFileSync(join(dir, 'dist', 'app.js'), 'export default {};');
}

function writeCatalog(catalog: unknown): void {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(getMarketplaceCatalogPath(), JSON.stringify(catalog));
}

beforeEach(() => {
  root = fs.mkdtempSync(join(tmpdir(), 'kabmo-remove-'));
  process.env.KABMO_MARKETPLACE_DIR = root;
  invalidatePanelScan();
});

afterEach(() => {
  delete process.env.KABMO_MARKETPLACE_DIR;
  invalidatePanelScan();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('removePanelPlugin', () => {
  test('removes the directory and its catalog entry, keeping other entries', async () => {
    for (const id of ['from-git', 'keep-me']) writePlugin(id);
    writeCatalog({
      name: 'Keep',
      plugins: [
        { name: 'keep-me', source: 'plugins/keep-me' },
        { name: 'from-git', source: 'plugins/from-git' },
      ],
    });
    invalidatePanelScan();
    expect((await discoverPanelPlugins()).panels).toHaveLength(2);

    expect((await removePanelPlugin('from-git')).ok).toBe(true);
    expect(fs.existsSync(join(root, 'plugins', 'from-git'))).toBe(false);

    // Pruning is by SOURCE, so an entry the removal does not name survives.
    const catalog = JSON.parse(fs.readFileSync(getMarketplaceCatalogPath(), 'utf8')) as {
      name: string;
      plugins: Array<{ source: string }>;
    };
    expect(catalog.plugins.map((entry) => entry.source)).toEqual(['plugins/keep-me']);
    expect(catalog.name).toBe('Keep');

    const after = await discoverPanelPlugins();
    expect(after.panels.map((panel) => panel.pluginId)).toEqual(['keep-me']);
    expect(after.errors).toEqual([]);
  });

  test('refuses an id that is not installed', async () => {
    const result = await removePanelPlugin('nope');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('No installed plugin');
  });

  test('reports a catalog it could not prune, with the directory still removed', async () => {
    writePlugin('demo');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(getMarketplaceCatalogPath(), '{ not json');

    const result = await removePanelPlugin('demo');
    expect(result.ok).toBe(true);
    expect(result.error).toContain('not valid JSON');
    expect(fs.existsSync(join(root, 'plugins', 'demo'))).toBe(false);
  });

  test('refuses an id that would escape the plugins directory', async () => {
    const result = await removePanelPlugin('../../etc');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Invalid plugin id');
  });
});
