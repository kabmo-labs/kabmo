/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The stored baseline and refusal records.
 *
 * Two properties matter and both are silent when wrong: a baseline must be
 * REPLACED rather than merged (a stale path from a previous version would read as
 * a deleted file and block the sync forever), and "recorded as empty" must stay
 * distinguishable from "never recorded" — the first means an install wrote
 * nothing, the second means the check did not exist yet and the sync must run.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  clearBaseline,
  readBaseline,
  readBaselines,
  readBlockedSyncs,
  writeBaseline,
  writeBlockedSync,
} from '@/server/lib/panels/baseline.server';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { getDb } from '@/server/db.server';
import { writeSettingsJson } from '@/server/lib/db/settings-store';

beforeEach(() => {
  isolateDb();
});

afterEach(() => {
  releaseDb();
});

describe('baselines', () => {
  test('a plugin with no baseline reads as null, not as empty', async () => {
    expect(await readBaseline('demo')).toBeNull();
  });

  test('a recorded empty baseline stays distinguishable from none', async () => {
    await writeBaseline('demo', {});
    // `{}` is truthy, so the sync knows the check applies and the install wrote
    // nothing; `null` is what makes it fall back to running.
    expect(await readBaseline('demo')).toEqual({});
  });

  test('writing replaces the whole entry', async () => {
    await writeBaseline('demo', { 'a.ts': 'h1', 'gone.ts': 'h2' });
    await writeBaseline('demo', { 'a.ts': 'h1' });
    // A merged write would leave `gone.ts` behind, and the next comparison would
    // report it as a deletion the user never made.
    expect(await readBaseline('demo')).toEqual({ 'a.ts': 'h1' });
  });

  test('plugins are independent', async () => {
    await writeBaseline('one', { 'a.ts': 'h1' });
    await writeBaseline('two', { 'b.ts': 'h2' });
    expect(Object.keys(await readBaselines()).sort()).toEqual(['one', 'two']);
    await clearBaseline('one');
    expect(Object.keys(await readBaselines())).toEqual(['two']);
  });

  test('clearing a plugin with no baseline is a no-op', async () => {
    await clearBaseline('never');
    expect(await readBaselines()).toEqual({});
  });

  test('a malformed stored value reads as no baselines', async () => {
    await writeSettingsJson(await getDb(), 'omp_panel_plugin_baselines', ['not', 'an', 'object']);
    expect(await readBaselines()).toEqual({});
  });
});

describe('blocked syncs', () => {
  test('a record carries the time and the changed paths', async () => {
    await writeBlockedSync('demo', { at: 1234, changed: ['src/a.ts', 'src/b.ts'] });
    expect(await readBlockedSyncs()).toEqual({ demo: { at: 1234, changed: ['src/a.ts', 'src/b.ts'] } });
  });

  test('clearing one leaves the others', async () => {
    await writeBlockedSync('one', { at: 1, changed: ['a'] });
    await writeBlockedSync('two', { at: 2, changed: ['b'] });
    await writeBlockedSync('one', null);
    expect(Object.keys(await readBlockedSyncs())).toEqual(['two']);
  });

  test('a malformed record is dropped rather than rendered', async () => {
    await writeSettingsJson(await getDb(), 'omp_panel_plugin_sync_blocked', {
      ok: { at: 1, changed: ['x'] },
      bad: 'nope',
      partial: { at: 'soon', changed: 'x' },
    });
    const records = await readBlockedSyncs();
    expect(records.ok).toEqual({ at: 1, changed: ['x'] });
    // A non-object is not a record, and a non-array `changed` becomes an empty
    // list — the plugin is still reported as blocked, which is the fact that
    // matters, rather than vanishing.
    expect(records.bad).toBeUndefined();
    expect(records.partial).toEqual({ at: 0, changed: [] });
  });
});
