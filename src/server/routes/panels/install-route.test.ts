/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The install route's mutation verbs: forget, auto-update, check, update,
 * update_all and force_sync.
 *
 * Split from `routes.test.ts` (which keeps the plugin FILE routes) because the
 * two answer different questions and each now has enough cases to deserve its
 * own budget: the file routes are a security boundary, while these are the
 * pane's buttons.
 *
 * What is pinned here is what a second implementation would get wrong:
 *
 * - **`update` dispatches on the SOURCE.** A bundled install takes the store's
 *   copy; a local directory is refused by naming why nothing publishes it, and
 *   a missing plugin is refused too. A silent no-op would read as success.
 * - **the store copy goes through the sync's EDIT GATE.** A hand-edited tree is
 *   refused and the differing file is named — the override stays the blocked
 *   notice's own button — so Update never becomes a one-click force-sync.
 * - **`update_all` never aborts on one refusal.** The plugin with local changes
 *   is reported by name while the untouched one still updates, and the response
 *   is a 200 because something DID happen.
 */

import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { join } from 'node:path';

import { action as installAction } from '@/server/routes/panels/install';
import { discoverPanelPlugins, getMarketplacePluginsDir, invalidatePanelScan } from '@/server/lib/panels/registry.server';
import { writeBaseline } from '@/server/lib/panels/baseline.server';
import { hashTrackedFiles } from '@/server/lib/panels/local-edits.server';
import { dirs, MANIFEST, post, usePanelRouteFixtures, writePlugin } from '@/server/routes/panels/panel-routes.test-util';

usePanelRouteFixtures();

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

  test('update refuses a plugin that is not installed', async () => {
    const response = await post(installAction, { type: 'update', pluginId: 'ghost' });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain('No installed plugin');
  });

  test('update refuses a local directory by naming why nothing publishes it', async () => {
    // A hand-copied plugin has no remote and the store does not ship it. The
    // refusal is the answer: a silent no-op would read as a successful update.
    writePlugin('demo', getMarketplacePluginsDir());
    invalidatePanelScan();

    const response = await post(installAction, { type: 'update', pluginId: 'demo' });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain('local directory');
  });

  test('update requires a plugin id', async () => {
    expect((await post(installAction, { type: 'update' })).status).toBe(400);
  });

  test('update applies the store copy of a BUNDLED install', async () => {
    // The button a bundled card renders: the store ships 1.1.0 while the install
    // sits at 1.0.0, and the whole payload comes back with the new version.
    writePlugin('demo', getMarketplacePluginsDir());
    writePlugin('demo', join(dirs.bundled, 'plugins'), { ...MANIFEST, version: '1.1.0' });
    invalidatePanelScan();

    const response = await post(installAction, { type: 'update', pluginId: 'demo' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      updated: boolean;
      plugins: Array<{ pluginId: string; version: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.updated).toBe(true);
    const installed = body.plugins.find((plugin) => plugin.pluginId === 'demo');
    expect(installed?.version).toBe('1.1.0');

    const manifest = JSON.parse(
      fs.readFileSync(join(getMarketplacePluginsDir(), 'demo', 'kabmo.json'), 'utf8'),
    ) as { version: string };
    expect(manifest.version).toBe('1.1.0');
  });

  test('update refuses a bundled install whose files the user edited', async () => {
    // The edit gate is the sync's, not the button's: an update must not become
    // the force-sync escape hatch by being reachable in one click. The baseline
    // is what PROVES Kabmo wrote the directory, so it is written here — an
    // install with no baseline predates the gate and is meant to run.
    writePlugin('demo', getMarketplacePluginsDir());
    writePlugin('demo', join(dirs.bundled, 'plugins'), { ...MANIFEST, version: '1.1.0' });
    await writeBaseline('demo', await hashTrackedFiles(join(getMarketplacePluginsDir(), 'demo')));
    fs.writeFileSync(join(getMarketplacePluginsDir(), 'demo', 'README.md'), '# edited by hand');
    invalidatePanelScan();

    const response = await post(installAction, { type: 'update', pluginId: 'demo' });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; syncBlocked: Record<string, unknown> };
    expect(body.error).toContain('local changes');
    expect(Object.keys(body.syncBlocked)).toEqual(['demo']);
    // Nothing was replaced: the user's file still says what they wrote.
    expect(fs.readFileSync(join(getMarketplacePluginsDir(), 'demo', 'README.md'), 'utf8')).toBe('# edited by hand');
  });

  test('update_all answers even when nothing is installed', async () => {
    const response = await post(installAction, { type: 'update_all' });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { ok: boolean }).ok).toBe(true);
  });

  test('update_all updates the store copy and reports a refused plugin', async () => {
    // One pass over every installed plugin: the plugin with an edited file is
    // refused BY NAME while the untouched one still updates — a refusal must
    // never abort the others.
    writePlugin('demo', getMarketplacePluginsDir());
    writePlugin('demo', join(dirs.bundled, 'plugins'), { ...MANIFEST, version: '1.1.0' });
    writePlugin('other', getMarketplacePluginsDir(), { ...MANIFEST, id: 'other', name: 'Other' });
    writePlugin('other', join(dirs.bundled, 'plugins'), { ...MANIFEST, id: 'other', name: 'Other', version: '1.1.0' });
    await writeBaseline('other', await hashTrackedFiles(join(getMarketplacePluginsDir(), 'other')));
    fs.writeFileSync(join(getMarketplacePluginsDir(), 'other', 'README.md'), '# edited by hand');
    invalidatePanelScan();

    const response = await post(installAction, { type: 'update_all' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      error?: string;
      plugins: Array<{ pluginId: string; version: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.plugins.find((plugin) => plugin.pluginId === 'demo')?.version).toBe('1.1.0');
    expect(body.plugins.find((plugin) => plugin.pluginId === 'other')?.version).toBe('1.0.0');
    expect(body.error).toContain('other');
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
