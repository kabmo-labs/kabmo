/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The compiled-fixture cache: where it lives, and the only code that deletes
 * from it.
 *
 * Separate from `executable-stub.ts` because it has a second consumer that
 * cannot import it: the E2E `globalSetup` runs in a Playwright worker with
 * `@types/node` and no Bun, and `executable-stub.ts` compiles with `Bun.build`.
 * Everything here is `node:`-only, so both layers sweep the same directory under
 * the same age rule instead of growing a second copy of the fact.
 *
 * The cache is keyed by a hash of the stub's SOURCE, which is why a stub must
 * never embed a per-run value (a `mkdtempSync` path): that misses the cache on
 * every run and leaves a ~90 MB binary behind each time. Measured: `bun test`
 * grew this directory by ~200 MB per run, which is how it reached 40 GB on a
 * developer machine.
 */

import { readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Where compiled fixtures live, so a suite re-run reuses them. */
export const STUB_CACHE_ROOT = join(tmpdir(), 'kabmo-test-bins');

/**
 * How long a compiled fixture may go unused before it is dropped.
 *
 * A week, not the two hours the E2E temp sweep uses: this directory exists to be
 * reused ACROSS runs, so a short floor would throw away exactly what it is for.
 * The age only has to be long enough that a fixture a live run is using cannot
 * be a week old.
 */
export const STUB_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Delete compiled fixtures nobody has used for `maxAgeMs`.
 *
 * Returns what it removed, so a caller can report the reclaim rather than
 * deleting gigabytes silently. `root` and `now` are injectable because this
 * function DELETES BY PATH: a test that ran it against the real cache would
 * destroy fixtures other suites are using in the same run.
 */
export function pruneStubCache(
  options: { root?: string; now?: number; maxAgeMs?: number } = {},
): string[] {
  const root = options.root ?? STUB_CACHE_ROOT;
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? STUB_CACHE_MAX_AGE_MS;
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    // No cache yet, which is the normal state of a fresh machine.
    return [];
  }

  const removed: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry);
    try {
      // mtime, not birthtime: an entry keeps being written while its build runs,
      // so mtime is what says whether anyone is still using it.
      if (now - statSync(path).mtimeMs < maxAgeMs) continue;
      rmSync(path, { recursive: true, force: true });
      removed.push(path);
    } catch {
      // Locked or already gone: the next run tries again.
    }
  }
  return removed;
}
