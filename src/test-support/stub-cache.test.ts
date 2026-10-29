/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The compiled-fixture cache's only deleter.
 *
 * This runs against an injected root, never the real `$TMPDIR/kabmo-test-bins`:
 * the function deletes by path, so a test aimed at the real cache would remove
 * the binaries the suites running beside it are about to spawn.
 *
 * The cases that matter are the two halves of the age rule — an unused fixture
 * goes, a recently written one stays — because getting the direction wrong is
 * silent: too aggressive and every run recompiles ~90 MB, too lax and the cache
 * is the 40 GB directory this module exists to prevent.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { pruneStubCache, STUB_CACHE_MAX_AGE_MS, STUB_CACHE_ROOT } from '@/test-support/stub-cache';

const roots: string[] = [];

/** A private cache root with one entry per given name, aged by `ageMs` against `nowMs`. */
function makeRoot(nowMs: number, entries: { name: string; ageMs: number }[]): string {
  const root = mkdtempSync(join(tmpdir(), 'kabmo-stub-cache-'));
  roots.push(root);
  for (const { name, ageMs } of entries) {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, name);
    writeFileSync(file, 'binary');
    const stamp = (nowMs - ageMs) / 1000;
    utimesSync(dir, stamp, stamp);
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('pruneStubCache', () => {
  test('removes an entry older than the age floor and keeps a fresh one', () => {
    const root = makeRoot(Date.now(), [
      { name: 'fake-omp-stale', ageMs: STUB_CACHE_MAX_AGE_MS + 60_000 },
      { name: 'fake-omp-fresh', ageMs: 1_000 },
    ]);

    expect(pruneStubCache({ root })).toEqual([join(root, 'fake-omp-stale')]);
    expect(readdirSync(root)).toEqual(['fake-omp-fresh']);
  });

  test('the age floor is a boundary, not a fuzzy cut', () => {
    // Anchor the mtimes and the injected `now` to a WHOLE SECOND. `utimesSync`
    // takes seconds, and the round trip back into `mtimeMs` is exact only for
    // whole seconds plus whole milliseconds: a sub-millisecond fraction drifts
    // by about a millisecond on Windows, which flipped an entry pinned to the
    // boundary between two runs of the same commit (measured: green, then red,
    // on the Windows runner — the boundary case only). With the anchor, the
    // at-floor entry differs from `now` by EXACTLY the floor and the
    // under-floor entry by EXACTLY one millisecond less, on every platform —
    // so this still pins "only a strictly younger entry survives" (a `<=`
    // ceiling would keep `at-floor` and fail here) with no clock race.
    const anchorMs = Math.floor(Date.now() / 1000) * 1000;
    const root = makeRoot(anchorMs, [
      // Exactly the floor is stale: only a strictly younger entry survives, so
      // an entry can never be kept and dropped by two runs with the same age.
      { name: 'at-floor', ageMs: STUB_CACHE_MAX_AGE_MS },
      { name: 'under-floor', ageMs: STUB_CACHE_MAX_AGE_MS - 1 },
    ]);

    // The anchor is the prune's `now`, so neither entry races the clock between
    // `utimesSync` and the prune.
    expect(pruneStubCache({ root, now: anchorMs, maxAgeMs: STUB_CACHE_MAX_AGE_MS })).toEqual([
      join(root, 'at-floor'),
    ]);
    expect(readdirSync(root)).toEqual(['under-floor']);
  });

  test('a missing cache root is empty, not an error', () => {
    const root = join(tmpdir(), `kabmo-absent-cache-${process.pid}`);
    rmSync(root, { recursive: true, force: true });

    expect(pruneStubCache({ root })).toEqual([]);
  });

  test('a full sweep is repeatable: the second call has nothing left to remove', () => {
    // A whole second past the floor, not a millisecond: the case is about the
    // SECOND call finding nothing, and a 1 ms margin sits inside the timestamp
    // round trip's drift (see the boundary case).
    const root = makeRoot(Date.now(), [{ name: 'a', ageMs: STUB_CACHE_MAX_AGE_MS + 1_000 }]);

    expect(pruneStubCache({ root })).toHaveLength(1);
    expect(pruneStubCache({ root })).toEqual([]);
  });

  test('the cache lives under the temp directory, shared by `bun test` and the E2E setup', () => {
    // The E2E global setup and `executableStub` must agree on ONE directory; a
    // second name would mean a sweep that misses what the suites write.
    expect(STUB_CACHE_ROOT).toBe(join(tmpdir(), 'kabmo-test-bins'));
  });
});
