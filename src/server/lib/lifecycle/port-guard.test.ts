/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `acquirePortLock` — the per-port startup lease, which exists so two starters
 * racing on one free port fail with a message that names the real situation
 * instead of a bare `EADDRINUSE`.
 *
 * Both mechanisms are driven: the `flock(2)` lease and the PID-file fallback.
 * The fallback is FORCED where its recovery logic is the subject (a dead
 * holder, a recycled PID) — `flock` keys on the inode and ignores the file's
 * contents, so those branches are otherwise unreachable on this host. The claim
 * itself is `claim-port`.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { testPosix } from '@/test-support/platform';

import { flockAvailable } from '@/server/lib/lifecycle/flock';
import type { FlockHandle } from '@/server/lib/lifecycle/flock';
import { getProcessState } from '@/server/lib/lifecycle/identity';
import { getLockPath } from '@/server/lib/lifecycle/paths';
import { acquirePortLock } from '@/server/lib/lifecycle/port-guard';
import type { PortLock } from '@/server/lib/lifecycle/port-guard';
import { createLoopbackHarness, realFetch } from '@/test-support/loopback';

const harness = createLoopbackHarness();

let tempDir: string;
let originalDataDir: string | undefined;
const leases: (PortLock | FlockHandle)[] = [];

/** The flock singleton is anchored on `globalThis`; leaked state spans suites. */
function flockHost(): { __kabmoFlock?: unknown } {
  return globalThis as unknown as { __kabmoFlock?: unknown };
}

/**
 * Force the PID-file fallback for one test.
 *
 * `flock` keys on the inode and never reads the file, so the stale-holder and
 * recycled-PID recovery below — the only reason the fallback exists — cannot be
 * observed while the real mechanism is active.
 */
function usePidFileFallback(): void {
  flockHost().__kabmoFlock = { held: new Map(), available: false, lib: null };
}

function track<T extends PortLock | FlockHandle>(lease: T | null): T | null {
  if (lease) leases.push(lease);
  return lease;
}

beforeEach(() => {
  originalDataDir = Bun.env.KABMO_DATA_DIR;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-test-port-guard-'));
  Bun.env.KABMO_DATA_DIR = tempDir;
  // The guard asks the occupant whether it is a Kabmo server, over the global
  // fetch. A stub another file left installed would answer for it.
  globalThis.fetch = realFetch;
});

afterEach(async () => {
  await harness.dispose();
  for (const lease of leases.splice(0)) lease.release();
  delete flockHost().__kabmoFlock;
  if (originalDataDir === undefined) delete Bun.env.KABMO_DATA_DIR;
  else Bun.env.KABMO_DATA_DIR = originalDataDir;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('acquirePortLock', () => {
  test('grants a free port lock and re-grants it after release', async () => {
    const first = track(await acquirePortLock(4211, 0));
    expect(first).not.toBeNull();
    first!.release();

    // A released lock must not keep the next starter out.
    expect(track(await acquirePortLock(4211, 0))).not.toBeNull();
  });

  // The `flock(2)` half of this comparison does not exist on Windows: there the
  // PID-file fallback is the only mechanism, so "follows the active mechanism"
  // has no second mechanism to contrast against (and `flock` refcounts).
  testPosix('a second acquire while held follows the active mechanism', async () => {
    const first = track(await acquirePortLock(4212, 0));
    expect(first).not.toBeNull();
    const second = await acquirePortLock(4212, 0);

    if (flockAvailable()) {
      // `flock(2)` is per open-file-description, so the module refcounts instead
      // of deadlocking a second acquire inside one process.
      expect(second).not.toBeNull();
    } else {
      // The PID-file lock is exclusive by `wx` create: a live holder wins.
      expect(second).toBeNull();
    }
    second?.release();
  });

  test('reclaims a lock whose holder is dead', async () => {
    usePidFileFallback();
    const lockPath = getLockPath(4213);
    fs.writeFileSync(lockPath, String(await harness.deadPid()));

    const reclaimed = track(await acquirePortLock(4213, 0));

    expect(reclaimed).not.toBeNull();
    // The reclaimed lock is ours now, so releasing it removes the file.
    reclaimed!.release();
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  // A "stranger" vs "ours" verdict reads the process command line
  // (`getProcessState`); on Windows `commandLine` returns null, so every live
  // pid reads `unknown` and neither the reclaim nor the refusal below is
  // observable there.
  testPosix('reclaims a lock whose PID was recycled to a stranger', async () => {
    usePidFileFallback();
    // A live PID that is not Kabmo means the recorded instance is gone;
    // refusing here would block startup on a free port forever.
    const stranger = await harness.livePid();
    expect(getProcessState(stranger)).toBe('mismatched');
    fs.writeFileSync(getLockPath(4214), String(stranger));

    expect(track(await acquirePortLock(4214, 0))).not.toBeNull();
  });

  testPosix('refuses a lock held by a live Kabmo process', async () => {
    usePidFileFallback();
    const holder = await harness.spawnChamberHolder();
    const lockPath = getLockPath(4215);
    fs.writeFileSync(lockPath, String(holder.pid));

    expect(await acquirePortLock(4215, 0)).toBeNull();
    // A refused acquire must not damage the holder's lock file.
    expect(fs.readFileSync(lockPath, 'utf8')).toBe(String(holder.pid));
  });
});
