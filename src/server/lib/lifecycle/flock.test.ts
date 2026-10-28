/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `flock.ts` is the only thing between two starters and a bind race, so these
 * tests pin its kernel-level semantics rather than its API shape: a free lock
 * is granted and names its holder, a lock already held by ANOTHER process is
 * refused, a holder that dies without releasing frees the lease (the kernel
 * drops it — which is why no stale-holder recovery exists here), re-entry
 * within one process is refcounted, and releasing really releases.
 *
 * The cross-process case is the point of the module, so it is exercised
 * against a real second process (a throwaway `bun -e`, never an `omp` server)
 * instead of a fake. The same-inode/different-path case uses a symlink: it
 * bypasses the module's re-entrancy shortcut and asks `flock(2)` directly.
 *
 * POSIX-only (`describePosix`): `flock(2)` has no Windows equivalent, so every
 * lease semantics the module exposes is unreachable there.
 */

import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { flockAvailable, tryFlock } from '@/server/lib/lifecycle/flock';
import type { FlockHandle } from '@/server/lib/lifecycle/flock';
import { describePosix } from '@/test-support/platform';

/** Without `flock(2)` every lease test would assert the unavailability path. */
const flockWorks = flockAvailable();

let tempDir: string;
const leases: FlockHandle[] = [];
const children: Bun.Subprocess[] = [];

/** `tryFlock` plus cleanup bookkeeping, so no lease outlives its test. */
function acquire(lockPath: string): FlockHandle | null {
  const handle = tryFlock(lockPath);
  if (handle) leases.push(handle);
  return handle;
}

/**
 * A real second process holding `lockPath`, confirmed by its own stdout before
 * returning. It never releases: the test decides whether it exits.
 */
async function spawnLockHolder(lockPath: string): Promise<Bun.Subprocess> {
  const modulePath = path.join(import.meta.dir, 'flock.ts');
  // The subprocess loads the module by path at runtime — the specifier cannot
  // be a static import in a program assembled as a string for `bun -e`.
  const code = `
    const mod = await import(${JSON.stringify(modulePath)});
    const handle = mod.tryFlock(${JSON.stringify(lockPath)});
    console.log(handle ? 'held' : 'denied');
    await new Promise(() => {});
  `;
  const child = Bun.spawn({ cmd: ['bun', '-e', code], stdout: 'pipe', stderr: 'ignore' });
  children.push(child);
  const reader = (child.stdout as ReadableStream<Uint8Array>).getReader();
  const first = await reader.read();
  const said = new TextDecoder().decode(first.value ?? new Uint8Array());
  expect(said).toContain('held');
  return child;
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-test-flock-'));
});

afterEach(async () => {
  for (const child of children.splice(0)) {
    try {
      child.kill('SIGKILL');
      await child.exited;
    } catch {
      // Already gone.
    }
  }
  for (const lease of leases.splice(0)) lease.release();
  // `held` and the probe result live on a globalThis singleton shared with the
  // rest of the run; leaked state would hold a lock against a sibling suite.
  // The singleton is untyped on `globalThis`, so the shape is named once here.
  const host = globalThis as unknown as { __kabmoFlock?: unknown };
  delete host.__kabmoFlock;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describePosix('flockAvailable', () => {
  test('answers with a boolean and caches the answer', () => {
    const first = flockAvailable();
    expect(typeof first).toBe('boolean');
    // The probe writes a file in TMPDIR; answering it per call would be a
    // filesystem round-trip on every startup.
    expect(flockAvailable()).toBe(first);
  });
});

describePosix('tryFlock', () => {
  test('grants a free lock and records this process in the file', () => {
    if (!flockWorks) return;
    const file = path.join(tempDir, 'port.lock');
    const lease = acquire(file);

    expect(lease).not.toBeNull();
    expect(fs.readFileSync(file, 'utf8')).toBe(String(process.pid));
  });

  test('refuses a lock held by another process, and reclaims it when that process dies', async () => {
    if (!flockWorks) return;
    const file = path.join(tempDir, 'port.lock');
    const holder = await spawnLockHolder(file);

    // The whole reason the port handover uses flock: another live holder is a
    // refusal, not a wait, and no PID file can go stale here.
    expect(tryFlock(file)).toBeNull();

    holder.kill('SIGKILL');
    await holder.exited;

    const reclaimed = acquire(file);
    expect(reclaimed).not.toBeNull();
  });

  test('an unopenable lock path is refused rather than thrown', () => {
    if (!flockWorks) return;
    // A run directory that vanished under us must not take the server down.
    expect(tryFlock(path.join(tempDir, 'missing-dir', 'port.lock'))).toBeNull();
  });

  test('re-acquiring the same path is re-entrant and refcounted', () => {
    if (!flockWorks) return;
    const file = path.join(tempDir, 'port.lock');
    const link = path.join(tempDir, 'alias.lock');
    fs.symlinkSync(file, link);

    const first = acquire(file);
    const second = acquire(file);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();

    // Different path, same inode: `flock(2)` is asked directly here, so this
    // proves the kernel lock is still held after one of two refs was dropped.
    first!.release();
    expect(tryFlock(link)).toBeNull();

    second!.release();
    expect(acquire(link)).not.toBeNull();
  });

  test('releasing frees the lock and is idempotent', () => {
    if (!flockWorks) return;
    const file = path.join(tempDir, 'port.lock');
    const link = path.join(tempDir, 'alias.lock');
    fs.symlinkSync(file, link);

    const lease = acquire(file);
    expect(lease).not.toBeNull();
    lease!.release();
    lease!.release(); // A second release must not throw or double-close the fd.

    expect(acquire(link)).not.toBeNull();
  });
});
