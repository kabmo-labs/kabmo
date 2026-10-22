/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The bundled marketplace as a STORE.
 *
 * A plugin the package ships is an OFFER, not an install: it appears in the
 * catalog, contributes nothing to the activity bar, and is never scanned as a
 * panel. Installing it copies it into the working marketplace, where the scan
 * picks it up as an ordinary install. The two facts this file pins are the ones
 * a wrong answer hides: a store entry must not contribute a button before it is
 * installed, and once installed it must be attributed to the store so the pane
 * offers the right removal.
 *
 * Split from `registry.server.test.ts` because the two suites exercise different
 * questions — that one is the working marketplace's scan rules, this one is the
 * store list — and each needs its own fixture tree.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { discoverPanelPlugins, invalidatePanelScan } from '@/server/lib/panels/registry.server';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';

const VALID = { id: 'demo', name: 'Demo', version: '1.0.0', app: 'dist/app.js' };

let root = '';

/** A plugin directory in the WORKING marketplace, with its bundle. */
function writeInstalled(dirName: string, manifest: unknown): void {
  const dir = join(root, 'plugins', dirName);
  fs.mkdirSync(join(dir, 'dist'), { recursive: true });
  fs.writeFileSync(join(dir, 'kabmo.json'), JSON.stringify(manifest));
  fs.writeFileSync(join(dir, 'dist', 'app.js'), 'export default {};');
}

/** A store directory holding one offer, and the env override that points at it. */
function withStore(run: (bundled: string) => Promise<void>): Promise<void> {
  const bundled = fs.mkdtempSync(join(root, 'bundled-'));
  fs.mkdirSync(join(bundled, 'plugins', 'offer'), { recursive: true });
  fs.writeFileSync(join(bundled, 'plugins', 'offer', 'kabmo.json'), JSON.stringify({ ...VALID, id: 'offer' }));
  const previous = process.env.KABMO_BUNDLED_MARKETPLACE_DIR;
  process.env.KABMO_BUNDLED_MARKETPLACE_DIR = bundled;
  return run(bundled).finally(() => {
    if (previous === undefined) delete process.env.KABMO_BUNDLED_MARKETPLACE_DIR;
    else process.env.KABMO_BUNDLED_MARKETPLACE_DIR = previous;
    fs.rmSync(bundled, { recursive: true, force: true });
  });
}

beforeEach(async () => {
  root = fs.mkdtempSync(join(tmpdir(), 'kabmo-store-'));
  process.env.KABMO_MARKETPLACE_DIR = root;
  // The scan reads the disabled set, so it needs a database of its own before
  // the first read — see `@/test-support/isolated-db`.
  await isolateDb();
  invalidatePanelScan();
});

afterEach(async () => {
  delete process.env.KABMO_MARKETPLACE_DIR;
  await releaseDb();
  invalidatePanelScan();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('the bundled marketplace catalog', () => {
  test('lists bundled plugins that are not installed, without scanning them as panels', async () => {
    await withStore(async () => {
      invalidatePanelScan();
      const payload = await discoverPanelPlugins();
      // Available, and nothing more: the store does not contribute a button.
      expect(payload.catalog.map((entry) => entry.pluginId)).toEqual(['offer']);
      expect(payload.catalog[0].installed).toBe(false);
      // What a plugin CONTRIBUTES is known only once its bundle loads, so a
      // store entry carries the identity alone — there is nothing to promise.
      expect(payload.panels).toEqual([]);
    });
  });

  test('marks a bundled plugin installed once it is present in the working marketplace', async () => {
    await withStore(async (bundled) => {
      // The same id, installed: the working copy is what the scan reads, and the
      // store entry now reports itself as installed.
      const dir = join(bundled, 'plugins', 'offer');
      writeInstalled('offer', { ...VALID, id: 'offer' });
      expect(fs.existsSync(dir)).toBe(true);
      invalidatePanelScan();
      const payload = await discoverPanelPlugins();
      expect(payload.catalog[0].installed).toBe(true);
      expect(payload.plugins[0].bundled).toBe(true);
    });
  });
});
