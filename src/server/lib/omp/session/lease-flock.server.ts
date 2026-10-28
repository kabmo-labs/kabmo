/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Is a session's omp ownership lease held by another process?
 *
 * omp takes an OS `flock` on `<session-owners>/<id>.lock` for the life of the
 * omp process that opened the session (`tryAcquireSessionLease`). Asking
 * "is it held" is therefore a `flock` question, and this asks it with the same
 * primitive rather than shelling out to `lsof`.
 *
 * ## Why not a subprocess
 *
 * `lsof -t <file>` answers the same question, but it costs a process spawn plus
 * a full descriptor-table scan — the exact cost `libproc`/`/proc` exist in
 * `lifecycle/proc` to avoid (measured there: 32 ms for a spawn against 0.001 ms
 * for a direct call). A spawn at spawn-time also makes the guard's own failure
 * mode worse: an exhausted descriptor table fails `lsof` the same way it fails
 * the omp spawn it was meant to protect.
 *
 * ## The probe acquires, briefly
 *
 * `flock` has no "test without taking". The probe takes `LOCK_EX | LOCK_NB`,
 * which fails IMMEDIATELY (never blocks) when another holder exists, and
 * releases at once when it succeeds. The window in which this process holds the
 * lock is microseconds, and only ever when the lease was free — the same
 * acquire-and-release omp itself performs, so no new race is introduced.
 *
 * A missing lease file is NOT "unknown": omp creates it on the first claim and
 * never deletes it, so its absence means the session was never claimed — free.
 */

import fs from 'fs';
import { dlopen, FFIType, type FFIFunction, type Library } from 'bun:ffi';

/** `open(2)` access mode; `flock(2)` locking modes. */
const O_RDONLY = 0;
const LOCK_EX = 2;
const LOCK_NB = 4;
const LOCK_UN = 8;

const SYMBOLS = {
  open: { args: [FFIType.cstring, FFIType.i32], returns: FFIType.i32 },
  close: { args: [FFIType.i32], returns: FFIType.i32 },
  flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
} satisfies Record<string, FFIFunction>;

/** libc path per platform; null where `flock` does not exist (Windows). */
function libcPath(): string | null {
  if (process.platform === 'darwin') return '/usr/lib/libSystem.B.dylib';
  if (process.platform === 'linux') return 'libc.so.6';
  return null;
}

let cached: Library<typeof SYMBOLS> | null | undefined;

/** Open libc once; a host that cannot is remembered as unavailable. */
function bindLibc(): Library<typeof SYMBOLS> | null {
  if (cached !== undefined) return cached;
  const path = libcPath();
  if (path === null) {
    cached = null;
    return null;
  }
  try {
    cached = dlopen(path, SYMBOLS);
  } catch {
    cached = null;
  }
  return cached;
}

/**
 * `true` when another process holds `leasePath`, `false` when it is free, and
 * `null` when this host cannot answer (Windows, or a libc that would not open).
 *
 * A `null` is not "free": callers must fall back to another signal rather than
 * spawn into a session that may be owned elsewhere.
 */
export function leaseHeldByAnother(leasePath: string): boolean | null {
  if (!fs.existsSync(leasePath)) return false;
  const libc = bindLibc();
  if (libc === null) return null;
  const fd = libc.symbols.open(Buffer.from(`${leasePath}\0`), O_RDONLY);
  if (fd < 0) return null;
  try {
    const acquired = libc.symbols.flock(fd, LOCK_EX | LOCK_NB) === 0;
    if (acquired) libc.symbols.flock(fd, LOCK_UN);
    return !acquired;
  } finally {
    libc.symbols.close(fd);
  }
}

/**
 * Hold an exclusive lock on `leasePath` for as long as the returned handle is
 * alive. Exported for tests, which need a REAL second holder to prove the probe
 * distinguishes held from free without spawning anything.
 */
export function holdLeaseForTest(leasePath: string): { release: () => void } {
  const libc = bindLibc();
  if (libc === null) throw new Error('flock unavailable on this host');
  const fd = libc.symbols.open(Buffer.from(`${leasePath}\0`), O_RDONLY);
  if (fd < 0) throw new Error(`could not open ${leasePath}`);
  if (libc.symbols.flock(fd, LOCK_EX | LOCK_NB) !== 0) {
    libc.symbols.close(fd);
    throw new Error(`could not lock ${leasePath}`);
  }
  return {
    release: () => {
      libc.symbols.flock(fd, LOCK_UN);
      libc.symbols.close(fd);
    },
  };
}
