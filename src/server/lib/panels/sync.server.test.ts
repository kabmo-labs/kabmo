/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Keeping an installed bundled plugin in step with the store the package ships.
 *
 * Three properties decide whether this pass is safe to run on every boot, and
 * each of them is a failure that is invisible until it has already overwritten
 * something: the provenance gate (a hand-copied directory must not be replaced
 * just because a store entry shares its id), the git exclusion (a clone that
 * shares an id must not be replaced by it), and the preservation of
 * `node_modules`/`dist` (the store ships no build output, so wiping those would
 * leave the plugin unservable until a rebuild).
 *
 * The local-edit gate has its own suite (`sync.local-edits.test.ts`).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { join } from 'node:path';

import { forceSyncBundledPlugin, syncBundledPlugins } from '@/server/lib/panels/sync.server';
import { installPanelPluginFromGit } from '@/server/lib/panels/install.server';
import { changedPaths, hashTrackedFiles } from '@/server/lib/panels/local-edits.server';
import { readBaseline, readBlockedSyncs, writeBaseline } from '@/server/lib/panels/baseline.server';
import {
  FIXTURE_MANIFEST as MANIFEST,
  installBundled,
  setupSyncFixture,
  teardownSyncFixture,
  writePlugin,
  type SyncFixture,
} from '@/server/lib/panels/sync.fixture.test-util';

const hasGit = Boolean(Bun.which('git'));

let fixture: SyncFixture;
let root = '';
let store = '';
let work = '';

beforeEach(async () => {
  fixture = await setupSyncFixture();
  root = fixture.root;
  store = fixture.store;
  work = fixture.work;
});

afterEach(async () => {
  await teardownSyncFixture(fixture);
});

describe('syncBundledPlugins', () => {
  test('replaces an install whose store copy is newer', async () => {
    writePlugin(join(root, 'plugins', 'demo'), MANIFEST, { 'src/marker.txt': 'installed' });
    writePlugin(join(store, 'plugins', 'demo'), { ...MANIFEST, version: '2.0.0' }, { 'src/marker.txt': 'store' });

    const result = await syncBundledPlugins();
    expect(result.updated).toHaveLength(1);
    expect(result.updated[0]).toMatchObject({ pluginId: 'demo', from: '1.0.0', to: '2.0.0' });

    const manifest = JSON.parse(fs.readFileSync(join(root, 'plugins', 'demo', 'kabmo.json'), 'utf8')) as {
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

  test('leaves an equal version alone when Kabmo cannot prove it wrote the install', async () => {
    // No baseline, so provenance is unknown and the version gate governs.
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
    // Kabmo upgrade would cost a network round trip for a tree that did not
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
 * The reported bug: a store change that did NOT move the manifest version was
 * never applied, so the only way to get it was to remove the plugin and install
 * it again.
 *
 * Measured on a real install: the product rename rewrote every bundled file AND
 * reset the versions to `0.0.1`, so the version gate saw "not newer" forever
 * while the recorded baseline still described the pre-rename files — which made
 * the local-edit gate report the store's own updates as the user's edits.
 */
describe('store content that did not bump its version', () => {
  test('a fix shipped without a version bump is applied', async () => {
    await installBundled(fixture, '1.0.0', { 'src/app.tsx': 'export default { old: true };' });
    // The store changes, the version does not — a shipped fix whose bump was
    // missed, which is exactly what left users stuck.
    writePlugin(join(store, 'plugins', 'demo'), { ...MANIFEST, version: '1.0.0' }, {
      'src/app.tsx': 'export default { fixed: true };',
    });

    const result = await syncBundledPlugins();
    expect(result.blocked).toEqual([]);
    expect(result.updated).toHaveLength(1);
    expect(result.updated[0]).toMatchObject({ pluginId: 'demo', contentOnly: true });
    expect(fs.readFileSync(join(root, 'plugins', 'demo', 'src', 'app.tsx'), 'utf8')).toContain('fixed');
  });

  test('a stale baseline does not read as the user editing every file', async () => {
    // The install and the store already agree, but the recorded baseline
    // describes a copy that no longer exists — the state the rename produced.
    writePlugin(join(store, 'plugins', 'demo'), MANIFEST, { 'src/app.tsx': 'export default { current: true };' });
    writePlugin(join(root, 'plugins', 'demo'), MANIFEST, { 'src/app.tsx': 'export default { current: true };' });
    await writeBaseline('demo', { 'src/app.tsx': 'a-hash-of-a-file-that-is-gone', 'package.json': 'also-gone' });

    // Now the store moves on again. The stale baseline must not block it.
    writePlugin(join(store, 'plugins', 'demo'), MANIFEST, { 'src/app.tsx': 'export default { newer: true };' });

    const result = await syncBundledPlugins();
    expect(result.blocked).toEqual([]);
    expect(result.updated).toHaveLength(1);
    expect(fs.readFileSync(join(root, 'plugins', 'demo', 'src', 'app.tsx'), 'utf8')).toContain('newer');
  });

  test('a stale baseline is healed even when the store has nothing new', async () => {
    // The exact state the rename left on a real install: the store and the
    // install already agree, and the baseline describes neither. Nothing is
    // applied, so this pass must still re-record the baseline — otherwise the
    // NEXT release's fix reads as a user edit on every path and the plugin is
    // stuck until it is reinstalled.
    writePlugin(join(store, 'plugins', 'demo'), MANIFEST, { 'src/app.tsx': 'export default { current: true };' });
    writePlugin(join(root, 'plugins', 'demo'), MANIFEST, { 'src/app.tsx': 'export default { current: true };' });
    await writeBaseline('demo', { 'src/app.tsx': 'a-hash-of-a-file-that-is-gone' });

    expect((await syncBundledPlugins()).updated).toEqual([]);
    const healed = await readBaseline('demo');
    expect(healed).not.toBeNull();
    expect(changedPaths(healed ?? {}, await hashTrackedFiles(join(root, 'plugins', 'demo')))).toEqual([]);

    // And the next release's fix then applies with no further action.
    writePlugin(join(store, 'plugins', 'demo'), MANIFEST, { 'src/app.tsx': 'export default { newer: true };' });
    const next = await syncBundledPlugins();
    expect(next.blocked).toEqual([]);
    expect(next.updated).toHaveLength(1);
  });

  test('a real edit still blocks, even with a trusted baseline', async () => {
    // The healing above must not become "overwrite whatever the user wrote":
    // an install that differs from BOTH the baseline and the store is the
    // user's own work.
    await installBundled(fixture, '1.0.0', { 'src/note.txt': 'original' });
    fs.writeFileSync(join(root, 'plugins', 'demo', 'src', 'note.txt'), 'mine');
    writePlugin(join(store, 'plugins', 'demo'), { ...MANIFEST, version: '1.0.0' }, { 'src/note.txt': 'original' });

    const result = await syncBundledPlugins();
    expect(result.updated).toEqual([]);
    expect(result.blocked[0].changed).toEqual(['src/note.txt']);
    expect(fs.readFileSync(join(root, 'plugins', 'demo', 'src', 'note.txt'), 'utf8')).toBe('mine');
  });

  test('a hand-copied directory still keeps the version gate', async () => {
    // No baseline means unknown provenance: an equal-version store entry must
    // not replace a directory Kabmo cannot prove it wrote.
    writePlugin(join(root, 'plugins', 'demo'), MANIFEST, { 'src/note.txt': 'mine' });
    writePlugin(join(store, 'plugins', 'demo'), MANIFEST, { 'src/note.txt': 'store' });

    expect((await syncBundledPlugins()).updated).toEqual([]);
    expect(fs.readFileSync(join(root, 'plugins', 'demo', 'src', 'note.txt'), 'utf8')).toBe('mine');
  });

  test('a second pass is a no-op once the copy has landed', async () => {
    await installBundled(fixture, '1.0.0', { 'src/app.tsx': 'export default { old: true };' });
    writePlugin(join(store, 'plugins', 'demo'), { ...MANIFEST, version: '1.0.0' }, {
      'src/app.tsx': 'export default { fixed: true };',
    });
    expect((await syncBundledPlugins()).updated).toHaveLength(1);

    // The baseline was re-taken after the build, so the pass that just ran must
    // not be read as a difference on the next boot — a sync that re-applies
    // forever would rebuild the plugin on every start.
    expect((await syncBundledPlugins()).updated).toEqual([]);
  });
});

/**
 * The override: the user has seen which files differ and asked for the store's
 * copy anyway.
 */
describe('forceSyncBundledPlugin', () => {
  test('refuses a plugin that is not a bundled install', async () => {
    writePlugin(join(root, 'plugins', 'demo'), MANIFEST);
    const result = await forceSyncBundledPlugin('demo');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('No bundled plugin');
  });

  test('applies the store copy even when its version is not newer', async () => {
    // The case the override most often exists for: a stale baseline refusing an
    // update whose version did not move. Clearing the baseline and re-running
    // the pass made this a no-op, because a cleared baseline reads as unknown
    // provenance and the version gate then declines.
    await installBundled(fixture, '1.0.0', { 'src/note.txt': 'original' });
    fs.writeFileSync(join(root, 'plugins', 'demo', 'src', 'note.txt'), 'mine');
    expect((await syncBundledPlugins()).blocked).toHaveLength(1);

    const forced = await forceSyncBundledPlugin('demo');
    expect(forced.ok).toBe(true);
    expect(fs.readFileSync(join(root, 'plugins', 'demo', 'src', 'note.txt'), 'utf8')).toBe('original');
    expect(await readBlockedSyncs()).toEqual({});
    // The baseline now describes what the override wrote, so the next pass is
    // not read as a fresh edit.
    const after = await hashTrackedFiles(join(root, 'plugins', 'demo'));
    expect((await syncBundledPlugins()).blocked).toEqual([]);
    expect(after['src/note.txt']).toBeDefined();
  });
});
