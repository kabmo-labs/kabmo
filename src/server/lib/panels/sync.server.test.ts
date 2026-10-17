/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Keeping an installed bundled plugin in step with the store the package ships.
 *
 * Three properties decide whether this pass is safe to run on every boot, and
 * each of them is a failure that is invisible until it has already overwritten
 * something: the version gate (an older store must not roll an install back), the
 * git exclusion (a clone that shares an id with a store entry must not be
 * replaced by it), and the preservation of `node_modules`/`dist` (the store ships
 * no build output, so wiping those would leave the plugin unservable until a
 * rebuild).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { forceSyncBundledPlugin, syncBundledPlugins } from '@/server/lib/panels/sync.server';
import { installPanelPluginFromGit } from '@/server/lib/panels/install.server';
import { hashTrackedFiles } from '@/server/lib/panels/local-edits.server';
import { readBlockedSyncs, writeBaseline } from '@/server/lib/panels/baseline.server';
import { invalidatePanelScan } from '@/server/lib/panels/registry.server';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';

const hasGit = Boolean(Bun.which('git'));

let root = '';
let store = '';
let work = '';

const MANIFEST = { id: 'demo', name: 'Demo', version: '1.0.0', app: 'dist/app.js' };

/** A plugin directory: manifest, bundle, and optionally a marker file. */
function writePlugin(dir: string, manifest: unknown, files: Record<string, string> = {}): void {
  fs.mkdirSync(join(dir, 'dist'), { recursive: true });
  fs.writeFileSync(join(dir, 'ompchamber.json'), JSON.stringify(manifest));
  fs.writeFileSync(join(dir, 'dist', 'app.js'), 'export default {};');
  for (const [name, content] of Object.entries(files)) {
    const target = join(dir, name);
    fs.mkdirSync(join(target, '..'), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

beforeEach(() => {
  root = fs.mkdtempSync(join(tmpdir(), 'omp-sync-work-'));
  store = fs.mkdtempSync(join(tmpdir(), 'omp-sync-store-'));
  work = fs.mkdtempSync(join(tmpdir(), 'omp-sync-repos-'));
  process.env.OMPCHAMBER_MARKETPLACE_DIR = root;
  process.env.OMPCHAMBER_BUNDLED_MARKETPLACE_DIR = store;
  // The baseline and refusal records live in `app_settings`, so this suite needs
  // an isolated database: a shared handle would read the developer's real one.
  isolateDb();
  invalidatePanelScan();
});

afterEach(() => {
  delete process.env.OMPCHAMBER_MARKETPLACE_DIR;
  delete process.env.OMPCHAMBER_BUNDLED_MARKETPLACE_DIR;
  releaseDb();
  invalidatePanelScan();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(store, { recursive: true, force: true });
  fs.rmSync(work, { recursive: true, force: true });
});

describe('syncBundledPlugins', () => {
  test('replaces an install whose store copy is newer', async () => {
    writePlugin(join(root, 'plugins', 'demo'), MANIFEST, { 'src/marker.txt': 'installed' });
    writePlugin(join(store, 'plugins', 'demo'), { ...MANIFEST, version: '2.0.0' }, { 'src/marker.txt': 'store' });

    const result = await syncBundledPlugins();
    expect(result.updated).toHaveLength(1);
    expect(result.updated[0]).toMatchObject({ pluginId: 'demo', from: '1.0.0', to: '2.0.0' });

    const manifest = JSON.parse(fs.readFileSync(join(root, 'plugins', 'demo', 'ompchamber.json'), 'utf8')) as {
      version: string;
    };
    expect(manifest.version).toBe('2.0.0');
    expect(fs.readFileSync(join(root, 'plugins', 'demo', 'src', 'marker.txt'), 'utf8')).toBe('store');
  });

  test('leaves an install alone when the store is not newer', async () => {
    writePlugin(join(root, 'plugins', 'demo'), { ...MANIFEST, version: '3.0.0' }, { 'src/marker.txt': 'installed' });
    writePlugin(join(store, 'plugins', 'demo'), { ...MANIFEST, version: '2.0.0' }, { 'src/marker.txt': 'store' });

    const result = await syncBundledPlugins();
    expect(result.updated).toEqual([]);
    // The gate is what keeps a downgrade from ever being applied.
    expect(fs.readFileSync(join(root, 'plugins', 'demo', 'src', 'marker.txt'), 'utf8')).toBe('installed');
  });

  test('leaves an equal version alone', async () => {
    writePlugin(join(root, 'plugins', 'demo'), MANIFEST, { 'src/marker.txt': 'installed' });
    writePlugin(join(store, 'plugins', 'demo'), MANIFEST, { 'src/marker.txt': 'store' });

    expect((await syncBundledPlugins()).updated).toEqual([]);
    expect(fs.readFileSync(join(root, 'plugins', 'demo', 'src', 'marker.txt'), 'utf8')).toBe('installed');
  });

  test('preserves node_modules but takes the store dist when it ships one', async () => {
    writePlugin(join(root, 'plugins', 'demo'), MANIFEST, { 'node_modules/dep/package.json': '{"name":"dep"}' });
    fs.writeFileSync(join(root, 'plugins', 'demo', 'dist', 'app.js'), 'export default { stale: true };');
    // The store DISTRIBUTES its bundle rather than building one — the shape a
    // plugin with no `src/` has. Keeping the install's old dist would serve the
    // previous version's code while the manifest beside it said otherwise.
    writePlugin(join(store, 'plugins', 'demo'), { ...MANIFEST, version: '2.0.0' });
    fs.writeFileSync(join(store, 'plugins', 'demo', 'dist', 'app.js'), 'export default { fromStore: true };');

    await syncBundledPlugins();
    // Dependencies are never refetched: the store ships none, and an install per
    // chamber upgrade would cost a network round trip for a tree that did not
    // change.
    expect(fs.existsSync(join(root, 'plugins', 'demo', 'node_modules', 'dep', 'package.json'))).toBe(true);
    expect(fs.readFileSync(join(root, 'plugins', 'demo', 'dist', 'app.js'), 'utf8')).toContain('fromStore');
  });

  test('a store copy with no dist leaves the install built', async () => {
    writePlugin(join(root, 'plugins', 'demo'), MANIFEST);
    writePlugin(join(store, 'plugins', 'demo'), { ...MANIFEST, version: '2.0.0' });

    await syncBundledPlugins();
    // The store ships no build output, so the install's own bundle stays and the
    // rebuild regenerates it from the new sources.
    expect(fs.existsSync(join(root, 'plugins', 'demo', 'dist', 'app.js'))).toBe(true);
  });

  test.skipIf(!hasGit)('never replaces a git clone that shares a store id', async () => {
    const repo = fs.mkdtempSync(join(work, 'repo-'));
    writePlugin(repo, MANIFEST, { 'src/marker.txt': 'clone' });
    const run = (args: string[]) => Bun.spawnSync(['git', '-C', repo, ...args], { stdout: 'pipe', stderr: 'pipe' });
    run(['init', '-q']);
    // Pin the line ending: a Windows host defaults `core.autocrlf` to true, which
    // rewrites every checked-out file to CRLF.
    run(['config', 'core.autocrlf', 'false']);
    run(['config', 'core.eol', 'lf']);
    run(['config', 'user.email', 'test@example.com']);
    run(['config', 'user.name', 'Test']);
    run(['add', '-A']);
    run(['commit', '-q', '-m', 'init']);
    expect((await installPanelPluginFromGit(repo)).ok).toBe(true);

    // The store offers a NEWER copy of the same id. It must still not win: the
    // directory on disk is the user's own repository.
    writePlugin(join(store, 'plugins', 'demo'), { ...MANIFEST, version: '9.0.0' }, { 'src/marker.txt': 'store' });

    expect((await syncBundledPlugins()).updated).toEqual([]);
    expect(fs.readFileSync(join(root, 'plugins', 'demo', 'src', 'marker.txt'), 'utf8')).toBe('clone');
  });

  test('a store entry with no install is skipped', async () => {
    writePlugin(join(store, 'plugins', 'never-installed'), MANIFEST);
    expect((await syncBundledPlugins()).updated).toEqual([]);
    expect(fs.existsSync(join(root, 'plugins', 'never-installed'))).toBe(false);
  });

  test('no bundled store at all is a no-op', async () => {
    fs.rmSync(store, { recursive: true, force: true });
    writePlugin(join(root, 'plugins', 'demo'), MANIFEST);
    expect(await syncBundledPlugins()).toEqual({ updated: [], blocked: [], failed: [] });
  });
});

/**
 * The local-edit gate. The sync REPLACES files, so a plugin whose tree no longer
 * matches what the install wrote is refused — and the baseline has to be stable
 * across the install's own build, or every install would read as edited the first
 * time it built and the sync would never run again.
 */
describe('local edit protection', () => {
  /**
   * Install a bundled plugin the way the install path does: the store's copy is
   * written into the working marketplace, and the baseline is taken from what
   * landed. `files` therefore go into the STORE, or the install would carry a
   * file the store never had — a state an install cannot produce.
   */
  async function installBundled(version: string, files: Record<string, string> = {}): Promise<void> {
    writePlugin(join(store, 'plugins', 'demo'), { ...MANIFEST, version }, files);
    writePlugin(join(root, 'plugins', 'demo'), { ...MANIFEST, version }, files);
    await writeBaseline('demo', await hashTrackedFiles(join(root, 'plugins', 'demo')));
  }

  test('an edited file blocks the sync and is named', async () => {
    await installBundled('1.0.0', { 'src/note.txt': 'original' });
    fs.writeFileSync(join(root, 'plugins', 'demo', 'src', 'note.txt'), 'mine');
    writePlugin(join(store, 'plugins', 'demo'), { ...MANIFEST, version: '2.0.0' });

    const result = await syncBundledPlugins();
    expect(result.updated).toEqual([]);
    expect(result.blocked).toHaveLength(1);
    expect(result.blocked[0].changed).toEqual(['src/note.txt']);
    // The edit survives — that is the whole point.
    expect(fs.readFileSync(join(root, 'plugins', 'demo', 'src', 'note.txt'), 'utf8')).toBe('mine');
    // And the refusal is recorded for the pane.
    expect((await readBlockedSyncs())['demo'].changed).toEqual(['src/note.txt']);
  });

  test('an added file blocks the sync', async () => {
    await installBundled('1.0.0');
    fs.writeFileSync(join(root, 'plugins', 'demo', 'src-extra.js'), 'export default {};');
    writePlugin(join(store, 'plugins', 'demo'), { ...MANIFEST, version: '2.0.0' });

    const result = await syncBundledPlugins();
    expect(result.blocked[0].changed).toContain('src-extra.js');
  });

  test('a deleted file blocks the sync', async () => {
    await installBundled('1.0.0', { 'src/note.txt': 'original' });
    fs.rmSync(join(root, 'plugins', 'demo', 'src', 'note.txt'));
    writePlugin(join(store, 'plugins', 'demo'), { ...MANIFEST, version: '2.0.0' });

    expect((await syncBundledPlugins()).blocked[0].changed).toEqual(['src/note.txt']);
  });

  test('an unchanged tree syncs, and the new baseline allows the NEXT sync', async () => {
    await installBundled('1.0.0');
    writePlugin(join(store, 'plugins', 'demo'), { ...MANIFEST, version: '2.0.0' });
    expect((await syncBundledPlugins()).updated).toHaveLength(1);

    // The baseline was re-taken after the build, so the tree the sync just wrote
    // is not read as an edit — without this the pass would block itself forever.
    writePlugin(join(store, 'plugins', 'demo'), { ...MANIFEST, version: '3.0.0' });
    const second = await syncBundledPlugins();
    expect(second.updated).toHaveLength(1);
    expect(second.blocked).toEqual([]);
  });

  test('build output and lockfiles are not edits', async () => {
    // A plugin WITH source: its `dist` is this build's output, so its hashes
    // change on every build and tracking it would block the sync forever.
    await installBundled('1.0.0', { 'src/app.tsx': 'export default {};' });
    fs.writeFileSync(join(root, 'plugins', 'demo', 'bun.lock'), '{}');
    fs.mkdirSync(join(root, 'plugins', 'demo', 'node_modules', 'dep'), { recursive: true });
    fs.writeFileSync(join(root, 'plugins', 'demo', 'node_modules', 'dep', 'package.json'), '{"name":"dep"}');
    fs.writeFileSync(join(root, 'plugins', 'demo', 'dist', 'app.js'), 'export default { built: true };');
    writePlugin(join(store, 'plugins', 'demo'), { ...MANIFEST, version: '2.0.0' }, { 'src/app.tsx': 'export default {};' });

    const result = await syncBundledPlugins();
    expect(result.blocked).toEqual([]);
    expect(result.updated).toHaveLength(1);
  });

  test('an edited bundle of a plugin with no SOURCE blocks the sync', async () => {
    // The shape this gate exists for: a plugin with no `src/` DISTRIBUTES its
    // bundle, so `dist` is content the user can edit rather than build output.
    // Excluding it let the sync silently overwrite the edit — measured against a
    // live server before this case existed.
    writePlugin(join(store, 'plugins', 'demo'), MANIFEST);
    writePlugin(join(root, 'plugins', 'demo'), MANIFEST);
    await writeBaseline('demo', await hashTrackedFiles(join(root, 'plugins', 'demo')));

    fs.writeFileSync(join(root, 'plugins', 'demo', 'dist', 'app.js'), 'export default { MINE: true };');
    writePlugin(join(store, 'plugins', 'demo'), { ...MANIFEST, version: '2.0.0' });

    const result = await syncBundledPlugins();
    expect(result.blocked).toHaveLength(1);
    expect(result.blocked[0].changed).toEqual(['dist/app.js']);
    expect(fs.readFileSync(join(root, 'plugins', 'demo', 'dist', 'app.js'), 'utf8')).toContain('MINE');
  });

  test('a plugin with no baseline runs, so an upgrade cannot freeze it', async () => {
    // An install written before this check existed. Refusing would leave it on
    // the old version forever with no way to say why.
    writePlugin(join(root, 'plugins', 'demo'), MANIFEST);
    writePlugin(join(store, 'plugins', 'demo'), { ...MANIFEST, version: '2.0.0' });

    expect((await syncBundledPlugins()).updated).toHaveLength(1);
  });

  test('reverting the edit lets the next pass sync, with no user action', async () => {
    await installBundled('1.0.0', { 'src/note.txt': 'original' });
    fs.writeFileSync(join(root, 'plugins', 'demo', 'src', 'note.txt'), 'mine');
    writePlugin(join(store, 'plugins', 'demo'), { ...MANIFEST, version: '2.0.0' });
    expect((await syncBundledPlugins()).blocked).toHaveLength(1);

    fs.writeFileSync(join(root, 'plugins', 'demo', 'src', 'note.txt'), 'original');
    const result = await syncBundledPlugins();
    expect(result.updated).toHaveLength(1);
    expect(result.blocked).toEqual([]);
    // The refusal record is cleared, or the pane would keep reporting a fault
    // the user has already resolved.
    expect(await readBlockedSyncs()).toEqual({});
  });

  test('the override replaces the edited files and clears the refusal', async () => {
    await installBundled('1.0.0', { 'src/note.txt': 'original' });
    fs.writeFileSync(join(root, 'plugins', 'demo', 'src', 'note.txt'), 'mine');
    writePlugin(join(store, 'plugins', 'demo'), { ...MANIFEST, version: '2.0.0' });
    expect((await syncBundledPlugins()).blocked).toHaveLength(1);

    const forced = await forceSyncBundledPlugin('demo');
    expect(forced.ok).toBe(true);
    expect(fs.readFileSync(join(root, 'plugins', 'demo', 'src', 'note.txt'), 'utf8')).toBe('original');
    expect(await readBlockedSyncs()).toEqual({});
  });

  test('the override refuses a plugin that is not a bundled install', async () => {
    writePlugin(join(root, 'plugins', 'demo'), MANIFEST);
    const result = await forceSyncBundledPlugin('demo');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('No bundled plugin');
  });
});
