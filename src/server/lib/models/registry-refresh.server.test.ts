/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A registry write is only visible to the readers that re-open the file, so the
 * refresh has an ORDER: recycle the pooled omp children, forget the probes that
 * measured the old file, re-probe when asked, and invalidate Kabmo's caches LAST
 * — invalidating first would let the `models` topic resolve from the pre-write
 * pool and cache that answer for another minute.
 */

import { describe, expect, test } from 'bun:test';

import {
  refreshModelRegistryAfterWrite,
  type RegistryRefreshDeps,
} from '@/server/lib/models/registry-refresh.server';

/** Record every side effect in the order it happened. */
function recorder(sharing: string[] = ['omp-acp']) {
  const steps: string[] = [];
  const deps: RegistryRefreshDeps = {
    restartUtilities: async () => { steps.push('restart'); },
    registryPath: async () => '/home/me/.omp/models.yml',
    sharing: (path) => {
      steps.push(`sharing:${path}`);
      return sharing as never;
    },
    forget: async (id) => { steps.push(`forget:${id}`); },
    reprobe: async (ids, cwd) => { steps.push(`reprobe:${ids.join(',')}:${cwd}`); },
    invalidate: () => { steps.push('invalidate'); },
  };
  return { steps, deps };
}

describe('refreshModelRegistryAfterWrite', () => {
  test('recycles the pool, forgets the probes, and invalidates LAST', async () => {
    const { steps, deps } = recorder();

    const sharing = await refreshModelRegistryAfterWrite({}, deps);

    expect(sharing).toEqual(['omp-acp'] as never);
    expect(steps).toEqual([
      'restart',
      'sharing:/home/me/.omp/models.yml',
      'forget:omp-acp',
      'invalidate',
    ]);
  });

  test('a re-probe runs on the shared harnesses, with the caller scope, before the caches drop', async () => {
    const { steps, deps } = recorder(['omp-rpc', 'omp-acp']);

    await refreshModelRegistryAfterWrite({ path: '/w/models.yml', reprobe: true, cwd: '/w' }, deps);

    expect(steps).toEqual([
      'restart',
      'sharing:/w/models.yml',
      'forget:omp-rpc',
      'forget:omp-acp',
      'reprobe:omp-rpc,omp-acp:/w',
      'invalidate',
    ]);
  });

  test('a write that cannot change a probe still recycles and invalidates', async () => {
    const { steps, deps } = recorder();

    const sharing = await refreshModelRegistryAfterWrite({ probes: false }, deps);

    expect(sharing).toEqual([]);
    expect(steps).toEqual(['restart', 'invalidate']);
  });

  test('the restart lands before any cache is dropped, even when it throws', async () => {
    const { steps, deps } = recorder();
    deps.restartUtilities = async () => {
      steps.push('restart');
      throw new Error('omp is missing');
    };

    await expect(refreshModelRegistryAfterWrite({}, deps)).rejects.toThrow('omp is missing');
    expect(steps).toEqual(['restart']);
  });
});
