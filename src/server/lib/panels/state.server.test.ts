/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The one-time fold of `hiddenRightPanels` into the disabled set.
 *
 * Hiding a view and disabling it were two axes with two stores, and hiding was
 * the built-ins' only one. There is now ONE axis and one store, so a list of
 * hidden ids has to become a list of disabled ones — or a view the user had
 * switched off comes back on their next load, which is the failure this pins.
 *
 * The migration is guarded by the old key's PRESENCE and deletes it as it goes,
 * so it must also be idempotent: a second read finds nothing to fold, and a
 * value written afterwards is never re-adopted.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  readDisabledPlugins,
  readPluginAutoUpdate,
  setPluginAutoUpdate,
  setPluginEnabled,
} from '@/server/lib/panels/state.server';
import { getDb } from '@/server/db.server';
import { readSettingsJson, writeSettingsJson } from '@/server/lib/db/settings-store';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';

async function writeHiddenPanels(ids: unknown): Promise<void> {
  const db = await getDb();
  await writeSettingsJson(db, 'omp_chamber_settings', { hiddenRightPanels: ids, theme: 'paper' });
}

async function readChamberBlob(): Promise<Record<string, unknown>> {
  const db = await getDb();
  return readSettingsJson<Record<string, unknown>>(db, 'omp_chamber_settings', {});
}

beforeEach(async () => {
  await isolateDb();
});

afterEach(async () => {
  await releaseDb();
});

describe('hiddenRightPanels migration', () => {
  test('a hidden list becomes the disabled set, and the old key is dropped', async () => {
    await writeHiddenPanels(['files', 'plugin:demo']);

    expect(await readDisabledPlugins()).toEqual(['files', 'plugin:demo']);

    // The retired key is GONE, which is what makes the pass idempotent rather
    // than merely once-per-process: nothing is left to fold.
    const blob = await readChamberBlob();
    expect(blob.hiddenRightPanels).toBeUndefined();
    // The rest of the blob is untouched — this is not a blob rewrite.
    expect(blob.theme).toBe('paper');
  });

  test('a second read does not re-adopt anything written afterwards', async () => {
    await writeHiddenPanels(['files']);
    expect(await readDisabledPlugins()).toEqual(['files']);

    // The user switches Files back on, so it leaves the disabled set.
    await setPluginEnabled('files', true);
    expect(await readDisabledPlugins()).toEqual([]);

    // The old list is still absent, so nothing brings it back.
    expect((await readChamberBlob()).hiddenRightPanels).toBeUndefined();
    expect(await readDisabledPlugins()).toEqual([]);
  });

  test('an existing disabled entry wins over the retired list', async () => {
    // The newer store is authoritative: a view the user switched off AFTER the
    // hidden list was written must stay off.
    await writeHiddenPanels(['wiki']);
    await setPluginEnabled('git', false);

    const disabled = await readDisabledPlugins();
    expect(disabled).toContain('git');
    expect(disabled).toContain('wiki');
  });

  test('a malformed or absent hidden list is left alone', async () => {
    await writeHiddenPanels('files');
    expect(await readDisabledPlugins()).toEqual([]);
    // A value that is not a list is not a list of ids: the key stays, and the
    // next read takes the same no-op path rather than half-adopting it.
    expect((await readChamberBlob()).hiddenRightPanels).toBe('files');
  });
});

/**
 * The auto-update flag shares the blob with the disabled set, so each writer has
 * to carry the other's value — a `writeSettingsJson` of one field alone would
 * silently drop what it did not name.
 */
describe('the auto-update flag', () => {
  test('defaults to OFF, because a pass rewrites plugin directories', async () => {
    expect(await readPluginAutoUpdate()).toBe(false);
  });

  test('survives a disabled-set write', async () => {
    await setPluginAutoUpdate(true);
    await setPluginEnabled('plugin:demo', false);

    expect(await readPluginAutoUpdate()).toBe(true);
    expect(await readDisabledPlugins()).toEqual(['plugin:demo']);
  });

  test('a disabled-set write does not clear it, and vice versa', async () => {
    await setPluginEnabled('plugin:demo', false);
    await setPluginAutoUpdate(true);

    expect(await readDisabledPlugins()).toEqual(['plugin:demo']);
    expect(await readPluginAutoUpdate()).toBe(true);
  });

  test('the hidden-panels migration carries it through', async () => {
    await setPluginAutoUpdate(true);
    await writeHiddenPanels(['files']);

    // The fold rewrites the whole blob, so it has to preserve a value written
    // before it ran.
    expect(await readDisabledPlugins()).toEqual(['files']);
    expect(await readPluginAutoUpdate()).toBe(true);
  });
});
