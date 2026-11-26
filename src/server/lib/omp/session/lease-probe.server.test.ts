/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Linux half of the lease probe, pinned against a lock this file takes
 * ITSELF.
 *
 * Linux keeps `flock(2)` and record locks (`F_OFD_SETLK`) in separate spaces, so
 * a probe written with the wrong primitive reports a live lease as free. That is
 * not hypothetical: omp 19.0.1 moved Linux to an open-file-description lock, and
 * a `flock`-based probe — which is what this module used to be — acquired a
 * lease a second process was holding (measured in a container, bun 1.4.4). The
 * failure is silent in the direction that hurts: Kabmo would spawn a second
 * writer on a session another instance owns, and omp forks the session.
 *
 * The holder here is taken with `fcntl` directly, never through the module under
 * test, so a regression to `flock` fails this case instead of passing it
 * tautologically.
 */

import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dlopen, FFIType, ptr } from 'bun:ffi';

import { leaseHeldByAnother } from '@kabmo-labs/kabmo-omp/session-runtime/lease-probe.server';

const linuxOnly = process.platform !== 'linux';

/** `F_WRLCK`, `F_UNLCK`, `SEEK_SET`, `F_OFD_SETLK` — as `fcntl(2)` names them. */
const F_WRLCK = 1;
const F_UNLCK = 2;
const SEEK_SET = 0;
const F_OFD_SETLK = 37;

const libc = linuxOnly
  ? null
  : dlopen('libc.so.6', {
      open: { args: [FFIType.cstring, FFIType.i32], returns: FFIType.i32 },
      close: { args: [FFIType.i32], returns: FFIType.i32 },
      fcntl: { args: [FFIType.i32, FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
    } as const);

/** `struct flock` (64-bit Linux) covering the whole file. */
function lockStruct(type: number): Uint8Array {
  const buffer = new Uint8Array(32);
  const view = new DataView(buffer.buffer);
  view.setInt16(0, type, true);
  view.setInt16(2, SEEK_SET, true);
  view.setBigInt64(8, 0n, true);
  view.setBigInt64(16, 0n, true);
  view.setInt32(24, 0, true);
  return buffer;
}

describe('leaseHeldByAnother on Linux', () => {
  test.skipIf(linuxOnly)('sees an open-file-description lock another fcntl call holds', () => {
    if (libc === null) throw new Error('libc unavailable');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-lease-probe-'));
    const lease = path.join(dir, 'ofd.lock');
    fs.writeFileSync(lease, '');

    // The probe runs BEFORE any holder: it must not leave a lock of its own
    // behind, or the "held" answer below could come from this process.
    expect(leaseHeldByAnother(lease)).toBe(false);

    const fd = libc.symbols.open(Buffer.from(`${lease}\0`), 2);
    expect(fd).toBeGreaterThanOrEqual(0);
    try {
      expect(libc.symbols.fcntl(fd, F_OFD_SETLK, ptr(lockStruct(F_WRLCK)))).toBe(0);
      expect(leaseHeldByAnother(lease)).toBe(true);
      libc.symbols.fcntl(fd, F_OFD_SETLK, ptr(lockStruct(F_UNLCK)));
      expect(leaseHeldByAnother(lease)).toBe(false);
    } finally {
      libc.symbols.close(fd);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
