/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two-directory fixture the bundled-sync suites run against: a WORKING
 * marketplace (what is installed) and a STORE (what the package ships).
 *
 * Split out because the two suites that pin the sync would otherwise each carry
 * a copy of the same setup, and the paths are the whole contract — a copy that
 * forgot `KABMO_BUNDLED_MARKETPLACE_DIR` would silently compare the real
 * package's store against a temp install and pass for the wrong reason.
 *
 * `isolateDb` is part of the setup, not a separate step: the baselines and the
 * refusal records live in `app_settings`, and a suite that skipped it would read
 * (and write) the developer's own database.
 */

import fs from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { invalidatePanelScan } from '@/server/lib/panels/registry.server';
import { hashTrackedFiles } from '@/server/lib/panels/local-edits.server';
import { writeBaseline } from '@/server/lib/panels/baseline.server';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';

export interface SyncFixture {
  /** The working marketplace root (installs live here). */
  root: string;
  /** The bundled store root (the package's copy). */
  store: string;
  /** A scratch directory for git repositories. */
  work: string;
}

export const FIXTURE_MANIFEST = { id: 'demo', name: 'Demo', version: '1.0.0', app: 'dist/app.js' };

/** Write a plugin directory: manifest, bundle, and any extra files. */
export function writePlugin(dir: string, manifest: unknown, files: Record<string, string> = {}): void {
  fs.mkdirSync(join(dir, 'dist'), { recursive: true });
  fs.writeFileSync(join(dir, 'kabmo.json'), JSON.stringify(manifest));
  fs.writeFileSync(join(dir, 'dist', 'app.js'), 'export default {};');
  for (const [name, content] of Object.entries(files)) {
    const target = join(dir, name);
    fs.mkdirSync(join(target, '..'), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

/** Create the fixture and point the process at it. Call from `beforeEach`. */
export async function setupSyncFixture(): Promise<SyncFixture> {
  const fixture: SyncFixture = {
    root: mkdtempSync(join(tmpdir(), 'omp-sync-work-')),
    store: mkdtempSync(join(tmpdir(), 'omp-sync-store-')),
    work: mkdtempSync(join(tmpdir(), 'omp-sync-repos-')),
  };
  process.env.KABMO_MARKETPLACE_DIR = fixture.root;
  process.env.KABMO_BUNDLED_MARKETPLACE_DIR = fixture.store;
  await isolateDb();
  invalidatePanelScan();
  return fixture;
}

/** Tear the fixture down. Call from `afterEach`. */
export async function teardownSyncFixture(fixture: SyncFixture): Promise<void> {
  delete process.env.KABMO_MARKETPLACE_DIR;
  delete process.env.KABMO_BUNDLED_MARKETPLACE_DIR;
  await releaseDb();
  invalidatePanelScan();
  for (const dir of [fixture.root, fixture.store, fixture.work]) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Install a bundled plugin the way the install path does: the store's copy is
 * written into the working marketplace, and the baseline is taken from what
 * landed. `files` therefore go into the STORE, or the install would carry a file
 * the store never had — a state an install cannot produce.
 */
export async function installBundled(
  fixture: SyncFixture,
  version: string,
  files: Record<string, string> = {},
): Promise<void> {
  writePlugin(join(fixture.store, 'plugins', 'demo'), { ...FIXTURE_MANIFEST, version }, files);
  writePlugin(join(fixture.root, 'plugins', 'demo'), { ...FIXTURE_MANIFEST, version }, files);
  await writeBaseline('demo', await hashTrackedFiles(join(fixture.root, 'plugins', 'demo')));
}
