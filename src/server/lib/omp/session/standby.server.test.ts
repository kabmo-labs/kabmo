/**
 * @license
 * SPDX-License-Identifier: MIT
 *
 * The standby-recycle contract, which is what makes an `omp update` visible
 * without a Kabmo restart.
 *
 * Three properties are load-bearing:
 *
 * - **Both pools are recycled**, and a failure in one does not skip the other —
 *   a pool that refuses to dispose is worse reported than left stale alongside
 *   a second stale pool.
 * - **The caches are dropped even when a pool reports nothing**, because a
 *   cached model/provider list served after the recycle makes the recycle look
 *   like it did nothing.
 * - **A burst coalesces onto one pass**, since an update and a button click can
 *   arrive together.
 *
 * The deps are injected rather than mocked through `mock.module`: swapping a
 * registry entry leaks into every other suite in the same `bun test` run.
 */

import { describe, expect, test } from 'bun:test';
import { createStandbyRecycler, type StandbyDeps } from '@/server/lib/omp/session/standby.server';

interface Recorder {
  deps: StandbyDeps;
  counts: { utility: number; prewarmed: number; invalidations: number };
}

function makeDeps(overrides: Partial<StandbyDeps> = {}): Recorder {
  const counts = { utility: 0, prewarmed: 0, invalidations: 0 };
  return {
    counts,
    deps: {
      restartUtility: async () => {
        counts.utility += 1;
        return 2;
      },
      restartPrewarmed: async () => {
        counts.prewarmed += 1;
        return 1;
      },
      invalidateCaches: () => {
        counts.invalidations += 1;
      },
      ...overrides,
    },
  };
}

describe('recycleStandbyProcesses', () => {
  test('recycles both pools and drops the caches', async () => {
    const { deps, counts } = makeDeps();
    const report = await createStandbyRecycler(deps).recycle();

    expect(report).toEqual({ utility: 2, prewarmed: 1 });
    expect(counts).toEqual({ utility: 1, prewarmed: 1, invalidations: 1 });
  });

  test('a failing pool does not stop the other one', async () => {
    const { deps, counts } = makeDeps({
      restartUtility: async () => {
        throw new Error('utility pool is wedged');
      },
    });
    const report = await createStandbyRecycler(deps).recycle();

    expect(report).toEqual({ utility: 0, prewarmed: 1 });
    expect(counts.prewarmed).toBe(1);
    expect(counts.invalidations).toBe(1);
  });

  test('an empty pool is still a pass, and still drops the caches', async () => {
    const { deps, counts } = makeDeps({
      restartUtility: async () => 0,
      restartPrewarmed: async () => 0,
    });
    const report = await createStandbyRecycler(deps).recycle();

    expect(report).toEqual({ utility: 0, prewarmed: 0 });
    expect(counts.invalidations).toBe(1);
  });

  test('a burst coalesces onto one in-flight pass', async () => {
    const resolvers: Array<() => void> = [];
    const { deps, counts } = makeDeps({
      restartUtility: () => new Promise<number>((resolve) => {
        counts.utility += 1;
        resolvers.push(() => resolve(3));
      }),
    });
    const recycler = createStandbyRecycler(deps);

    const first = recycler.recycle();
    const second = recycler.recycle();
    expect(second).toBe(first);
    resolvers[0]();
    expect(await first).toEqual({ utility: 3, prewarmed: 1 });
    expect(counts.utility).toBe(1);

    // A later trigger is a NEW pass, not the remembered promise.
    const third = recycler.recycle();
    expect(third).not.toBe(first);
    resolvers[1]();
    await third;
    expect(counts.utility).toBe(2);
  });
});
