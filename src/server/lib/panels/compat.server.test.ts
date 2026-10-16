/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Manifest COMPATIBILITY, as the scan applies it: engine ranges and required
 * capabilities.
 *
 * Split out of `registry.server.test.ts` when that file crossed the 350-line
 * ceiling. The two are different questions — that suite is about which
 * DIRECTORIES become plugins, this one is about which MANIFESTS are admitted —
 * and the capability half is where the interesting history is: the table named
 * only `panel` for releases while a plugin's server half, storage, RPC, realtime
 * and settings had all shipped, so a manifest requiring any of them was refused
 * by name for something the host did perfectly well.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  discoverPanelPlugins,
  getMarketplacePluginsDir,
  invalidatePanelScan,
} from '@/server/lib/panels/registry.server';
import { runningVersions } from '@/server/lib/panels/compat.server';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';

let root = '';

const VALID = {
  id: 'demo',
  name: 'Demo',
  version: '1.0.0',
  app: 'dist/app.js',
};

/** Write one plugin, so the scan has something to admit or refuse. */
function writePlugin(dirName: string, manifest: unknown): void {
  const dir = join(getMarketplacePluginsDir(), dirName);
  fs.mkdirSync(join(dir, 'dist'), { recursive: true });
  fs.writeFileSync(join(dir, 'ompchamber.json'), JSON.stringify(manifest));
  // The scan only publishes a plugin whose bundle exists; an unbuilt one is
  // reported as UNBUILT, which is a different list.
  fs.writeFileSync(join(dir, 'dist', 'app.js'), 'export default {};');
}

/** Write one plugin and scan it: the payload a compatibility test asserts on. */
async function scanWith(manifest: unknown) {
  writePlugin('demo', manifest);
  invalidatePanelScan();
  return discoverPanelPlugins();
}

beforeEach(() => {
  root = fs.mkdtempSync(join(tmpdir(), 'ompchamber-compat-'));
  process.env.OMPCHAMBER_MARKETPLACE_DIR = root;
  fs.mkdirSync(root, { recursive: true });
  // The scan reads the disabled set, which is a DATABASE read — so the suite
  // needs a database of its own before the first scan, or it opens the real one.
  isolateDb();
  invalidatePanelScan();
});

afterEach(() => {
  delete process.env.OMPCHAMBER_MARKETPLACE_DIR;
  releaseDb();
  invalidatePanelScan();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('manifest compatibility', () => {
  test('a satisfied engines range loads, and an absent one does too', async () => {
    // Absent means "any": every plugin that predates these fields keeps working.
    for (const engines of [undefined, { ompchamber: '>=1.0.0' }]) {
      const { panels, errors } = await scanWith({ ...VALID, engines });
      expect(errors).toEqual([]);
      expect(panels).toHaveLength(1);
    }
  });

  test('an unsatisfiable engines.ompchamber is refused, naming both versions', async () => {
    const { panels, errors } = await scanWith({ ...VALID, engines: { ompchamber: '^9.0.0' } });
    expect(panels).toEqual([]);
    expect(errors[0].reason).toContain('^9.0.0');
    expect(errors[0].reason).toContain(String((await runningVersions()).ompchamber));
  });

  test('a SHIPPED capability is admitted, not refused', async () => {
    // This test used to assert the opposite, with `capabilities: ['storage']`,
    // and it was pinning a bug: `HOST_CAPABILITIES` named only `panel` while a
    // plugin's storage, server half, RPC, realtime and settings had all shipped,
    // so a manifest requiring any of them was refused by name for something the
    // host did perfectly well. The rows are backfilled; see
    // `src/shared/lib/panels/capabilities.test.ts` for the table itself.
    for (const capability of ['storage', 'server', 'rpc', 'realtime', 'settings', 'repo-scope']) {
      const { panels, errors } = await scanWith({ ...VALID, capabilities: [capability] });
      expect(errors).toEqual([]);
      expect(panels).toHaveLength(1);
    }
  });

  test('an unknown capability is refused by name', async () => {
    const { panels, errors } = await scanWith({ ...VALID, capabilities: ['teleport'] });
    expect(panels).toEqual([]);
    expect(errors[0].reason).toContain('capability "teleport"');
  });

  test('a malformed range is refused as malformed, not as a mismatch', async () => {
    const { errors } = await scanWith({ ...VALID, engines: { ompchamber: 'not a range' } });
    expect(errors[0].reason).toContain('is not a valid version range');
  });
});
