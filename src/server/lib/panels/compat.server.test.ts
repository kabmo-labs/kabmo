/**
 * @license
 * SPDX-License-Identifier: MIT
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
  fs.writeFileSync(join(dir, 'kabmo.json'), JSON.stringify(manifest));
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

beforeEach(async () => {
  root = fs.mkdtempSync(join(tmpdir(), 'kabmo-compat-'));
  process.env.KABMO_MARKETPLACE_DIR = root;
  fs.mkdirSync(root, { recursive: true });
  // The scan reads the disabled set, which is a DATABASE read — so the suite
  // needs a database of its own before the first scan, or it opens the real one.
  await isolateDb();
  invalidatePanelScan();
});

afterEach(async () => {
  delete process.env.KABMO_MARKETPLACE_DIR;
  await releaseDb();
  invalidatePanelScan();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('manifest compatibility', () => {
  test('a satisfied engines range loads, and an absent one does too', async () => {
    // The range is derived from the RUNNING host, not written as a literal: a
    // literal `>=1.0.0` became unsatisfiable the moment the product restarted at
    // 0.0.1, and the test then failed for the version bump rather than for a
    // compatibility bug. Absent means "any": every plugin that predates these
    // fields keeps working.
    const current = (await runningVersions()).kabmo;
    if (!current) throw new Error('the running host reports no version');
    for (const engines of [undefined, { kabmo: `>=${current}` }]) {
      const { panels, errors } = await scanWith({ ...VALID, engines });
      expect(errors).toEqual([]);
      expect(panels).toHaveLength(1);
    }
  });

  test('an unsatisfiable engines.kabmo is refused, naming both versions', async () => {
    const { panels, errors } = await scanWith({ ...VALID, engines: { kabmo: '^9.0.0' } });
    expect(panels).toEqual([]);
    expect(errors[0].reason).toContain('^9.0.0');
    expect(errors[0].reason).toContain(String((await runningVersions()).kabmo));
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
    const { errors } = await scanWith({ ...VALID, engines: { kabmo: 'not a range' } });
    expect(errors[0].reason).toContain('is not a valid version range');
  });
});
