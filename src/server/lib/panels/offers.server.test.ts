/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The catalogs' OFFERS, and the origin every install gets from them.
 *
 * Two questions answered here, and both are easy to answer wrongly in a way that
 * looks right on screen:
 *
 * - a REMOTE offer (a `marketplace.json` entry whose `source` is a git URL) is a
 *   plugin the user can install without the marketplace holding it. Losing it
 *   makes a curated catalog look empty; counting it twice makes one plugin look
 *   like two;
 * - an install's ORIGIN decides who keeps it current — Kabmo's sync, the user's
 *   own `git pull`, or nobody — so a wrong value is a promise the pane cannot
 *   keep.
 *
 * `applySources` mutates the payload's own rows, which is what keeps one answer
 * per question: the alternative is a second list that can disagree with the one
 * the pane renders.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applySources, assembleCatalog } from '@/server/lib/panels/offers.server';
import type { PanelPluginStatus } from '@/shared/types';
import { removeDir } from '@/test-support/remove-dir';

let root = '';
let bundled = '';

/** Write a catalog body at a path, creating its parent directory. */
function writeCatalog(path: string, body: unknown): string {
  fs.mkdirSync(join(path, '..'), { recursive: true });
  fs.writeFileSync(path, JSON.stringify(body));
  return path;
}

/** A store plugin directory, with the manifest `kabmo.json` the scan reads. */
function writeStorePlugin(dirName: string, manifest: Record<string, unknown>): void {
  const dir = join(bundled, 'plugins', dirName);
  fs.mkdirSync(join(dir, 'dist'), { recursive: true });
  fs.writeFileSync(join(dir, 'kabmo.json'), JSON.stringify({ app: 'dist/app.js', ...manifest }));
  fs.writeFileSync(join(dir, 'dist', 'app.js'), 'export default {};');
}

/** A status row with everything the card needs, as the scan builds one. */
function status(overrides: Partial<PanelPluginStatus> = {}): PanelPluginStatus {
  return {
    pluginId: 'demo',
    name: 'Demo',
    version: '1.0.0',
    isPackage: false,
    built: true,
    enabled: true,
    bundled: false,
    origin: 'local',
    gitOrigin: null,
    settingsCount: 0,
    ...overrides,
  };
}

beforeEach(() => {
  root = fs.mkdtempSync(join(tmpdir(), 'kabmo-offers-'));
  bundled = fs.mkdtempSync(join(tmpdir(), 'kabmo-store-'));
});

afterEach(() => {
  removeDir(root);
  removeDir(bundled);
});

describe('assembleCatalog', () => {
  test('lists a store offer and a remote offer side by side', async () => {
    writeStorePlugin('session-info', { id: 'session-info', name: 'Session Info', version: '0.1.0' });
    const workingCatalog = writeCatalog(join(root, 'marketplace.json'), {
      plugins: [{ name: 'acme-panels', source: 'https://github.com/acme/panels.git', version: '1.4.0' }],
    });

    const catalog = await assembleCatalog({
      workingCatalogPath: workingCatalog,
      bundledRoot: bundled,
      installed: new Set(),
    });

    expect(catalog.map((entry) => `${entry.origin}:${entry.pluginId}`)).toEqual([
      'bundled:session-info',
      'git:acme-panels',
    ]);
  });

  test('a store offer wins over a remote one for the same id', async () => {
    // The store's directory is on disk, so it can draw an icon and a README, and
    // both rows would install the same id — two cards for one plugin.
    writeStorePlugin('demo', { id: 'demo', name: 'Demo', version: '1.0.0' });
    const workingCatalog = writeCatalog(join(root, 'marketplace.json'), {
      plugins: [{ name: 'demo', source: 'https://github.com/acme/demo.git' }],
    });

    const catalog = await assembleCatalog({
      workingCatalogPath: workingCatalog,
      bundledRoot: bundled,
      installed: new Set(),
    });

    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({ pluginId: 'demo', origin: 'bundled' });
  });

  test('a remote offer reports itself installed once its id is on disk', async () => {
    // The row STAYS with `installed: true` — the pane filters on that flag, and
    // dropping it would make "an offer you already installed" and "no offer at
    // all" indistinguishable.
    const workingCatalog = writeCatalog(join(root, 'marketplace.json'), {
      plugins: [{ name: 'demo', source: 'https://github.com/acme/demo.git' }],
    });

    const catalog = await assembleCatalog({
      workingCatalogPath: workingCatalog,
      bundledRoot: bundled,
      installed: new Set(['demo']),
    });

    expect(catalog).toEqual([expect.objectContaining({ pluginId: 'demo', installed: true })]);
  });

  test('a catalog that is not there contributes no offers', async () => {
    const catalog = await assembleCatalog({
      workingCatalogPath: join(root, 'missing.json'),
      bundledRoot: bundled,
      installed: new Set(),
    });
    expect(catalog).toEqual([]);
  });
});

describe('applySources', () => {
  test('a plugin the store publishes is bundled, and carries the store version', async () => {
    const plugins = [status({ pluginId: 'session-info', version: '0.0.1' })];
    const catalog = [
      {
        pluginId: 'session-info',
        name: 'Session Info',
        version: '0.2.0',
        origin: 'bundled' as const,
        installed: true,
      },
    ];
    applySources(plugins, catalog, {});
    expect(plugins[0]).toMatchObject({
      bundled: true,
      origin: 'bundled',
      latestVersion: '0.2.0',
    });
  });

  test('a clone is NEVER bundled, however its id reads', async () => {
    // The store offers this id, but the directory on disk is the user's own
    // repository — attributing it to the store would overwrite it on the next
    // boot, because the sync selects on this same flag.
    const plugins = [status({ pluginId: 'demo', gitOrigin: 'https://github.com/acme/demo.git' })];
    const catalog = [
      { pluginId: 'demo', name: 'Demo', version: '9.9.9', origin: 'bundled' as const, installed: true },
    ];
    applySources(plugins, catalog, {});
    expect(plugins[0]).toMatchObject({ bundled: false, origin: 'git' });
    // And it takes no version from the store: its source is its own remote.
    expect(plugins[0]?.latestVersion).toBeUndefined();
  });

  test('a git clone takes the version the freshness probe read', async () => {
    const plugins = [status({ pluginId: 'demo', gitOrigin: 'https://github.com/acme/demo.git' })];
    applySources(plugins, [], {
      demo: { current: 'aaa', latest: 'bbb', updateAvailable: true, checkedAt: 1, latestVersion: '2.0.0' },
    });
    expect(plugins[0]?.latestVersion).toBe('2.0.0');
  });

  test('a directory nobody published stays LOCAL, with no version to offer', async () => {
    const plugins = [status()];
    applySources(plugins, [], {});
    expect(plugins[0]).toMatchObject({ bundled: false, origin: 'local' });
    expect(plugins[0]?.latestVersion).toBeUndefined();
  });
});
