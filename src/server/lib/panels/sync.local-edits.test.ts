/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The local-edit gate. The sync REPLACES files, so a plugin whose tree no longer
 * matches what the install wrote is refused — and the baseline has to be stable
 * across the install's own build, or every install would read as edited the first
 * time it built and the sync would never run again.
 *
 * What the baseline must NOT do is outrank the trees in front of it: see
 * `baselineDescribesInstall`. A baseline that contradicts them describes a copy
 * this install never had, and obeying it is what made a bundled update
 * unrecoverable.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { join } from 'node:path';

import { syncBundledPlugins } from '@/server/lib/panels/sync.server';
import { hashTrackedFiles } from '@/server/lib/panels/local-edits.server';
import { readBlockedSyncs, writeBaseline } from '@/server/lib/panels/baseline.server';
import {
  FIXTURE_MANIFEST as MANIFEST,
  installBundled,
  setupSyncFixture,
  teardownSyncFixture,
  writePlugin,
  type SyncFixture,
} from '@/server/lib/panels/sync.fixture.test-util';

let fixture: SyncFixture;
let root = '';
let store = '';

beforeEach(async () => {
  fixture = await setupSyncFixture();
  root = fixture.root;
  store = fixture.store;
});

afterEach(async () => {
  await teardownSyncFixture(fixture);
});

describe('local edit protection', () => {
  test('an edited file blocks the sync and is named', async () => {
    await installBundled(fixture, '1.0.0', { 'src/note.txt': 'original' });
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
    await installBundled(fixture, '1.0.0');
    fs.writeFileSync(join(root, 'plugins', 'demo', 'src-extra.js'), 'export default {};');
    writePlugin(join(store, 'plugins', 'demo'), { ...MANIFEST, version: '2.0.0' });

    const result = await syncBundledPlugins();
    expect(result.blocked[0].changed).toContain('src-extra.js');
  });

  test('a deleted file blocks the sync', async () => {
    await installBundled(fixture, '1.0.0', { 'src/note.txt': 'original' });
    fs.rmSync(join(root, 'plugins', 'demo', 'src', 'note.txt'));
    writePlugin(join(store, 'plugins', 'demo'), { ...MANIFEST, version: '2.0.0' });

    expect((await syncBundledPlugins()).blocked[0].changed).toEqual(['src/note.txt']);
  });

  test('an unchanged tree syncs, and the new baseline allows the NEXT sync', async () => {
    await installBundled(fixture, '1.0.0');
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
    await installBundled(fixture, '1.0.0', { 'src/app.tsx': 'export default {};' });
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
    await installBundled(fixture, '1.0.0', { 'src/note.txt': 'original' });
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
});
