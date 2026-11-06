/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The roster write, through the route the client actually calls.
 *
 * Two facts are easy to get wrong here, and both are silent:
 *
 *  - the ANSWER decides what the switch shows. A toggle that reports success
 *    while the server kept the previous value leaves the UI disagreeing with the
 *    database until the next reload;
 *  - the built-in transport has no switch, and the refusal must be a real 400
 *    rather than a no-op the client would render as "saved".
 *
 * The probe-on-enable half is asserted at the store level (a real spawn needs an
 * agent installed), so these cases hold the roster alone.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { loadDisabledHarnesses, saveHarnessEnabled } from '@/server/lib/harness/enabled.server';

beforeEach(async () => {
  await isolateDb();
});

afterEach(async () => {
  await releaseDb();
});

afterAll(async () => {
  await releaseDb();
});

describe('the harness roster', () => {
  test('nothing stored means every adapter is on', async () => {
    expect(await loadDisabledHarnesses()).toEqual([]);
  });

  test('switching off stores the DISABLED id, not the enabled roster', async () => {
    expect(await saveHarnessEnabled('claude', false)).toEqual(['claude']);
    expect(await loadDisabledHarnesses()).toEqual(['claude']);
  });

  test('switching on removes it and deletes the row when nothing is off', async () => {
    await saveHarnessEnabled('claude', false);
    expect(await saveHarnessEnabled('claude', true)).toEqual([]);
    // The empty list IS the default, so no row is left behind — that is what lets
    // an adapter added by a later build arrive switched on.
    expect(await loadDisabledHarnesses()).toEqual([]);
  });

  test('two harnesses switch independently', async () => {
    await saveHarnessEnabled('claude', false);
    await saveHarnessEnabled('cursor', false);
    expect((await loadDisabledHarnesses()).sort()).toEqual(['claude', 'cursor']);
    await saveHarnessEnabled('claude', true);
    expect(await loadDisabledHarnesses()).toEqual(['cursor']);
  });

  test('the built-in transport is refused, in both directions', async () => {
    // Refused OUT LOUD, not ignored: a build with `omp` over RPC off could run
    // no chat at all, and a silent no-op would render as "saved" in the UI.
    const off = await saveHarnessEnabled('omp-rpc', false).then(
      () => null,
      (cause: Error) => cause.message,
    );
    const on = await saveHarnessEnabled('omp-rpc', true).then(
      () => null,
      (cause: Error) => cause.message,
    );
    expect(off).toContain('built in');
    expect(on).toContain('built in');
    expect(await loadDisabledHarnesses()).toEqual([]);
  });

  test('an unknown id is refused rather than invented', async () => {
    const message = await saveHarnessEnabled('not-an-agent', false).then(
      () => null,
      (cause: Error) => cause.message,
    );
    expect(message).toContain('Unknown harness');
    expect(await loadDisabledHarnesses()).toEqual([]);
  });
});
