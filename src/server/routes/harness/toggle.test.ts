/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Switching a harness on, through the route the UI calls.
 *
 * The user's correction, as an assertion: **enable must work for an agent that is
 * not installed.** The switch is a roster decision — the user may want the tab
 * present before they install the binary — so a missing executable must not
 * refuse it, and must not spawn anything either. Spawning a binary that is not
 * there produces an error report in place of a switch, which is exactly the
 * "enable failed" the user saw.
 *
 * So the cases below hold two facts:
 *
 *  - the roster write succeeds and is reported, installed or not;
 *  - no probe was attempted when the binary is absent.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { probes } from '@/server/lib/harness/probe-cache.server';
import { loadDisabledHarnesses } from '@/server/lib/harness/enabled.server';
import { action } from '@/server/routes/harness/root';

type Handler = (args: never) => unknown;

function call(request: Request): Promise<Response> {
  return (action as Handler)({ request, params: {} } as never) as Promise<Response>;
}

function toggle(id: string, enabled: boolean): Request {
  return new Request('http://localhost/api/harness', {
    method: 'POST',
    body: JSON.stringify({ probe: id, enabled }),
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(async () => {
  await isolateDb();
  probes().clear();
});

afterEach(async () => {
  await releaseDb();
  probes().clear();
});

afterAll(async () => {
  await releaseDb();
});

describe('switching a harness on', () => {
  test('an agent whose binary is NOT installed still switches on', async () => {
    // `cursor` is launched by `cursor-agent`, which this machine does not have —
    // the harness the user tried and watched fail. The switch is about the roster.
    const response = await call(toggle('cursor', true));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { enabled?: boolean; disabled?: string[]; probed?: boolean };
    expect(payload.enabled).toBe(true);
    // Nothing was spawned, because there is nothing to spawn.
    expect(payload.probed).toBe(false);
    expect(await loadDisabledHarnesses()).toEqual([]);
  });

  test('switching off an uninstalled agent works too', async () => {
    const response = await call(toggle('cursor', false));
    expect(response.status).toBe(200);
    expect(await loadDisabledHarnesses()).toEqual(['cursor']);
  });

  test('a launcher that exists is probed, and the answer rides the response', async () => {
    // `omp-acp` is launched by the `omp` binary this machine has, so the bonus
    // probe runs. Its capabilities are the agent's own; the assertion is merely
    // that one was attempted and reported.
    //
    // Guarded, because "exists" is the premise: a clean runner has no `omp`, so
    // `probed` is legitimately `false` there. Measured on both CI gates, where
    // this case alone failed with `Expected: true, Received: false` while the
    // same file passed locally — the enable half of the contract still runs.
    const response = await call(toggle('omp-acp', true));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { enabled?: boolean; probed?: boolean };
    // The roster half always holds: enabling works whether or not the binary is
    // here, which is the user's correction this suite exists for.
    expect(payload.enabled).toBe(true);
    // The probe half is conditional on the machine, so what is asserted is the
    // CONTRACT between the flag and the cache rather than the flag's value: a
    // reported probe left a record, a skipped one left none.
    expect(payload.probed).toBe(probes().has('omp-acp'));
  }, 120_000);

  test('the built-in transport is still refused, and leaves the roster alone', async () => {
    const response = await call(toggle('omp-rpc', false));
    expect(response.status).toBe(400);
    expect(await loadDisabledHarnesses()).toEqual([]);
  });

  test('an unknown harness id is refused', async () => {
    const response = await call(toggle('not-an-agent', true));
    expect(response.status).toBe(400);
    expect(await loadDisabledHarnesses()).toEqual([]);
  });
});
