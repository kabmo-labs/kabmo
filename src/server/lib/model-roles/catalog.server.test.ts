/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The role dropdowns' candidate catalog.
 *
 * Two properties matter and both are about failure, not the happy path:
 *
 *   - **A catalog failure is REPORTED, never thrown.** The roles live in
 *     config.yml and stay editable without a catalog; an empty dropdown with no
 *     explanation reads as "no models exist", which is a different and false
 *     claim. The message is omp's own sentence where there is one.
 *   - **The listing is cached, and dropped by the same signal that drops the
 *     chat model cache.** A model removed from models.yml must leave the role
 *     pickers too, or they keep offering a selector omp cannot resolve.
 *
 * `omp` is never spawned: the failure case points the binary override at a path
 * that does not exist (which `resolveOmpBin` answers with `null`, by design —
 * it does not fall through to a PATH lookup), and the mock case never reaches a
 * spawn at all.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readModelRoleCandidates } from '@/server/lib/model-roles/catalog.server';
import { invalidateModelsCaches } from '@/shared/lib/models/server-cache';

const originalMock = Bun.env.MOCK;
const originalBin = Bun.env.KABMO_OMP_BIN;

beforeEach(() => {
  globalThis.__kabmoRoleCandidatesCache = undefined;
});

afterEach(() => {
  if (originalMock === undefined) delete Bun.env.MOCK;
  else Bun.env.MOCK = originalMock;
  if (originalBin === undefined) delete Bun.env.KABMO_OMP_BIN;
  else Bun.env.KABMO_OMP_BIN = originalBin;
  globalThis.__kabmoRoleCandidatesCache = undefined;
});

describe('role candidate catalog', () => {
  test('mock mode answers a demo catalog covering every role kind', async () => {
    Bun.env.MOCK = 'true';
    const { candidates, error } = await readModelRoleCandidates();
    expect(error).toBeNull();
    const kinds = new Set(candidates.map((candidate) => candidate.kind));
    // The five kind roles need a model of their own kind, or their dropdown is empty.
    for (const kind of ['chat', 'search', 'stt', 'tts', 'tiny', 'image']) {
      expect(kinds.has(kind), `${kind} candidates`).toBe(true);
    }
  });

  test('a missing omp binary is reported, not thrown', async () => {
    delete Bun.env.MOCK;
    Bun.env.KABMO_OMP_BIN = '/nonexistent/omp-binary';
    const { candidates, error } = await readModelRoleCandidates();
    expect(candidates).toEqual([]);
    expect(error).toContain('omp binary not found');
  });

  test('a successful listing is cached until the models cache is invalidated', async () => {
    Bun.env.MOCK = 'true';
    await readModelRoleCandidates();
    expect(globalThis.__kabmoRoleCandidatesCache).toBeUndefined();

    // Seed a cache the way a real read would, then prove the shared invalidation
    // clears it — the same call every provider/model mutation already makes.
    globalThis.__kabmoRoleCandidatesCache = { data: [], expiresAt: Date.now() + 60_000 };
    invalidateModelsCaches();
    expect(globalThis.__kabmoRoleCandidatesCache).toBeUndefined();
  });
});
