/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The temp-dir registry, which is the only thing standing between a killed run
 * and a full disk.
 *
 * Driven through the real filesystem: every claim here is "this directory is
 * gone" or "this directory is still there", and a fake would assert the
 * bookkeeping rather than the effect.
 *
 * Every sweep case runs against its OWN root (`sweepStaleTempDirs({ root })`).
 * That is not tidiness: the sweep deletes by NAME, so a case pointed at the real
 * `$TMPDIR` reclaimed 964 directories a developer's earlier runs had left behind
 * — measured, and the reason the root became an option.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  E2E_TEMP_PREFIX,
  beginTempScope,
  makeProcessTempDir,
  makeTempDir,
  sweepStaleTempDirs,
  sweepTempScope,
  trackTempDir,
} from './temp-root';

const scratch: string[] = [];

afterEach(() => {
  // The registry's own sweep is what most cases assert; this only clears what a
  // failed assertion left, so one red case cannot poison the next.
  sweepTempScope();
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A private root for a sweep case, so nothing real is ever in range. */
function sweepRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'omc-temp-sweep-test-'));
  scratch.push(dir);
  return dir;
}

/** A directory inside `root`, created by hand and NOT registered. */
function entry(root: string, name: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Backdate a directory so the age floor sees it as a previous run's. */
function backdate(dir: string, hours = 24): void {
  const seconds = Date.now() / 1000 - hours * 60 * 60;
  utimesSync(dir, seconds, seconds);
}

describe('temp scope', () => {
  test('a test-scoped directory is removed by the sweep', () => {
    beginTempScope();
    const dir = makeTempDir('unit-scope-');
    expect(existsSync(dir)).toBe(true);
    expect(dir.startsWith(join(tmpdir(), E2E_TEMP_PREFIX))).toBe(true);

    sweepTempScope();
    expect(existsSync(dir)).toBe(false);
  });

  test('the sweep is idempotent, so a dispose() plus a sweep cannot fail', () => {
    beginTempScope();
    const dir = makeTempDir('unit-twice-');
    rmSync(dir, { recursive: true, force: true });
    expect(() => sweepTempScope()).not.toThrow();
    expect(() => sweepTempScope()).not.toThrow();
  });

  test('a NEW scope drops the previous one, so an interrupted run is not forgotten', () => {
    beginTempScope();
    const first = makeTempDir('unit-abandoned-');
    // No sweep: this is what an interrupted test leaves.
    beginTempScope();
    expect(existsSync(first)).toBe(false);
  });

  test('a process-scoped directory outlives the test sweep', () => {
    beginTempScope();
    const kept = makeProcessTempDir('unit-process-');
    const dropped = makeTempDir('unit-test-');
    sweepTempScope();
    // The compiled fake `omp` is this case: deleting it would break every spec
    // after the one that happened to build it.
    expect(existsSync(kept)).toBe(true);
    expect(existsSync(dropped)).toBe(false);
    rmSync(kept, { recursive: true, force: true });
  });

  test('trackTempDir is idempotent', () => {
    beginTempScope();
    const dir = makeTempDir('unit-idem-');
    trackTempDir(dir);
    trackTempDir(dir);
    sweepTempScope();
    expect(existsSync(dir)).toBe(false);
  });
});

describe('stale sweep', () => {
  test('removes only OUR directories, and only ones past the age floor', () => {
    const root = sweepRoot();
    const ours = entry(root, `${E2E_TEMP_PREFIX}old`);
    const fresh = entry(root, `${E2E_TEMP_PREFIX}fresh`);
    const foreign = entry(root, 'not-ours-old');
    backdate(ours);
    backdate(foreign);

    const removed = sweepStaleTempDirs({ root, maxAgeMs: 60 * 60 * 1000 });

    expect(removed).toEqual([ours]);
    expect(existsSync(ours)).toBe(false);
    // A live sibling run's directory is young; a name this layer never minted
    // is never touched, whatever its age.
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(foreign)).toBe(true);
  });

  test('a directory written this instant is never in range', () => {
    const root = sweepRoot();
    const fresh = entry(root, `${E2E_TEMP_PREFIX}now`);
    const removed = sweepStaleTempDirs({ root, now: Date.now(), maxAgeMs: 60_000 });
    expect(removed).toEqual([]);
    expect(existsSync(fresh)).toBe(true);
  });

  test('a nested directory is removed with its parent', () => {
    const root = sweepRoot();
    const parent = entry(root, `${E2E_TEMP_PREFIX}nested`);
    mkdirSync(join(parent, 'src', 'deep'), { recursive: true });
    backdate(parent);

    sweepStaleTempDirs({ root, maxAgeMs: 1000 });
    expect(existsSync(parent)).toBe(false);
  });

  test('an unreadable root is an empty sweep, not a throw', () => {
    const root = sweepRoot();
    rmSync(root, { recursive: true, force: true });
    expect(sweepStaleTempDirs({ root })).toEqual([]);
  });
});
