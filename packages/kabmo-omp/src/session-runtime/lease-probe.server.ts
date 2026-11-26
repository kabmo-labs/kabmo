/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Is a session's omp ownership lease held by another process?
 *
 * omp takes an OS lock on `<session-owners>/<id>.lock` for the life of the omp
 * process that opened the session (`tryAcquireSessionLease`). The primitive is
 * platform-dependent, and the probe has to speak the same one:
 *
 *  - **macOS**: `flock(2)`. There is no "test without taking", so the probe
 *    takes `LOCK_EX | LOCK_NB` (which fails immediately, never blocks, when a
 *    holder exists) and releases at once when it succeeds. The window in which
 *    this process holds the lock is microseconds and only ever when the lease
 *    was free — the same acquire-and-release omp itself performs.
 *  - **Linux**: an open-file-description lock (`F_OFD_SETLK`), since omp 19.0.1.
 *    A `flock(2)` probe CANNOT see it — Linux keeps `flock` and record-lock
 *    spaces separate — so the same probe that answers correctly on macOS
 *    reports "free" for a lease another omp holds. Measured in a Linux
 *    container (bun 1.4.4, 2026-11-20): with a second process holding an OFD
 *    write lock, the `flock` probe acquired (free) while `F_OFD_GETLK` returned
 *    `F_WRLCK`. The probe is therefore `F_OFD_GETLK`, which never takes the
 *    lock at all. Before 19.0.1 Linux used an abstract socket and wrote no file
 *    there, so this guard was blind on Linux either way; the pin made the file
 *    real, not the gap.
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
 * A missing lease file is NOT "unknown": omp creates it on the first claim and
 * never deletes it, so its absence means the session was never claimed — free.
 */

import fs from 'fs';
import { dlopen, FFIType, ptr, type FFIFunction, type Library } from 'bun:ffi';

/** `open(2)` access modes; `flock(2)` locking modes. */
const O_RDONLY = 0;
const O_RDWR = 2;
const LOCK_EX = 2;
const LOCK_NB = 4;
const LOCK_UN = 8;

/** `struct flock` fields; `fcntl(2)` lock types and commands. */
const F_WRLCK = 1;
const F_UNLCK = 2;
const SEEK_SET = 0;
const F_OFD_GETLK = 36;
const F_OFD_SETLK = 37;

/**
 * `struct flock` on 64-bit Linux: `l_type` (2), `l_whence` (2), 4 bytes of
 * padding, `l_start` (8), `l_len` (8), `l_pid` (4) and 4 bytes of trailing
 * padding. The 32-bit layout is different (16 bytes) and is deliberately not
 * guessed at — a wrong layout would read a lock type out of the wrong bytes.
 */
const FLOCK_BYTES = 32;

const SYMBOLS = {
  open: { args: [FFIType.cstring, FFIType.i32], returns: FFIType.i32 },
  close: { args: [FFIType.i32], returns: FFIType.i32 },
  flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  fcntl: { args: [FFIType.i32, FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
} satisfies Record<string, FFIFunction>;

type Libc = Library<typeof SYMBOLS>;

/** libc path per platform; null where neither primitive exists (Windows). */
function libcPath(): string | null {
  if (process.platform === 'darwin') return '/usr/lib/libSystem.B.dylib';
  if (process.platform === 'linux') return 'libc.so.6';
  return null;
}

let cached: Libc | null | undefined;

/** Open libc once; a host that cannot is remembered as unavailable. */
function bindLibc(): Libc | null {
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

/** Whether {@link FLOCK_BYTES} is this architecture's `struct flock`. */
const OFD_LAYOUT_KNOWN = ['x64', 'arm64', 'ppc64', 's390x', 'riscv64'].includes(process.arch);

/** A `struct flock` asking for `type` over the whole file. */
function flockStruct(type: number): Uint8Array {
  const buffer = new Uint8Array(FLOCK_BYTES);
  const view = new DataView(buffer.buffer);
  view.setInt16(0, type, true);
  view.setInt16(2, SEEK_SET, true);
  view.setBigInt64(8, 0n, true);
  view.setBigInt64(16, 0n, true);
  view.setInt32(24, 0, true);
  return buffer;
}

/** True when an OFD lock on `fd`'s file would conflict with a write lock. */
function ofdHeld(libc: Libc, fd: number): boolean | null {
  const buffer = flockStruct(F_WRLCK);
  if (libc.symbols.fcntl(fd, F_OFD_GETLK, ptr(buffer)) !== 0) return null;
  return new DataView(buffer.buffer).getInt16(0, true) !== F_UNLCK;
}

/**
 * `true` when another process holds `leasePath`, `false` when it is free, and
 * `null` when this host cannot answer (Windows, a libc that would not open, or
 * an architecture whose `struct flock` this module does not know).
 *
 * A `null` is not "free": callers must fall back to another signal rather than
 * spawn into a session that may be owned elsewhere.
 */
export function leaseHeldByAnother(leasePath: string): boolean | null {
  if (!fs.existsSync(leasePath)) return false;
  const libc = bindLibc();
  if (libc === null) return null;
  const isLinux = process.platform === 'linux';
  if (isLinux && !OFD_LAYOUT_KNOWN) return null;
  const fd = libc.symbols.open(Buffer.from(`${leasePath}\0`), O_RDONLY);
  if (fd < 0) return null;
  try {
    if (isLinux) return ofdHeld(libc, fd);
    const acquired = libc.symbols.flock(fd, LOCK_EX | LOCK_NB) === 0;
    if (acquired) libc.symbols.flock(fd, LOCK_UN);
    return !acquired;
  } finally {
    libc.symbols.close(fd);
  }
}

/**
 * Hold the lease `omp` would hold, for as long as the returned handle is alive.
 * Exported for tests, which need a REAL second holder to prove the probe
 * distinguishes held from free without spawning anything — so this takes the
 * platform's own primitive, not a portable stand-in.
 */
export function holdLeaseForTest(leasePath: string): { release: () => void } {
  const libc = bindLibc();
  if (libc === null) throw new Error('lease locks unavailable on this host');
  const isLinux = process.platform === 'linux';
  if (isLinux && !OFD_LAYOUT_KNOWN) throw new Error('struct flock layout unknown on this architecture');
  // A write lock needs a writable descriptor.
  const fd = libc.symbols.open(Buffer.from(`${leasePath}\0`), isLinux ? O_RDWR : O_RDONLY);
  if (fd < 0) throw new Error(`could not open ${leasePath}`);
  const release = isLinux
    ? () => {
        libc.symbols.fcntl(fd, F_OFD_SETLK, ptr(flockStruct(F_UNLCK)));
        libc.symbols.close(fd);
      }
    : () => {
        libc.symbols.flock(fd, LOCK_UN);
        libc.symbols.close(fd);
      };
  const acquired = isLinux
    ? libc.symbols.fcntl(fd, F_OFD_SETLK, ptr(flockStruct(F_WRLCK))) === 0
    : libc.symbols.flock(fd, LOCK_EX | LOCK_NB) === 0;
  if (!acquired) {
    libc.symbols.close(fd);
    throw new Error(`could not lock ${leasePath}`);
  }
  return { release };
}
