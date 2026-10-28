/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `flock(2)` through `bun:ffi`, for the port-handover lock.
 *
 * The kernel releases a flock when the holding process dies, which is exactly
 * the property a startup lock wants — no PID readback, no stale-holder
 * classification, and no polling loop to detect a dead holder. The previous
 * PID-file scheme needed all three: it wrote a PID, re-read it on every retry,
 * asked the OS whether that PID was still Kabmo (four `sysctl` calls per
 * question on macOS), and deleted the file to release.
 *
 * `flock` is exported by `libc.dylib` / `libSystem.B.dylib` / `libc.so.6`, so it
 * is reachable the same way `lib/lifecycle/proc/darwin.ts` reaches `sysctl`.
 * Windows has no `flock`, and a host can refuse `dlopen` or answer `ENOLCK`
 * (some NFS mounts) — `flockAvailable()` is a real capability probe, and every
 * caller keeps its own fallback for the false case.
 *
 * **The lock file is never unlinked while it may be held.** Removing it is the
 * classic flock race: another process that already opened the path keeps a
 * handle on the unlinked inode and acquires it successfully while a third
 * process creates a fresh file at the same path and also succeeds. Leaving the
 * file in place makes the inode the lock, which is what flock is for; the file
 * is an empty marker, one per port.
 */

import fs from 'fs';
import { dlopen, FFIType } from 'bun:ffi';
import type { FFIFunction, Library } from 'bun:ffi';

const LOCK_EX = 2;
/** Non-blocking: fail immediately rather than waiting inside the syscall. */
const LOCK_NB = 4;

const FLOCK_SYMBOLS = {
  flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
} satisfies Record<string, FFIFunction>;

/** Library names to try, in the order each platform resolves them. */
const LIBC_NAMES = ['libc.dylib', 'libSystem.B.dylib', 'libc.so.6'] as const;

/**
 * Held leases and the probe result, on `globalThis` rather than in module
 * bindings.
 *
 * A `bun --hot` reload re-evaluates this module while the process (and its open
 * descriptors) lives on. A fresh module-level Map would forget that this PID
 * already holds the port's lock, so the reloaded server would open a second fd,
 * find the lock taken by its own previous fd, and refuse to start.
 */
interface FlockHost {
  /** `lockPath` → the fd holding it and how many acquires it backs. */
  held: Map<string, { fd: number; refs: number }>;
  /** Tri-state capability probe: undefined until asked, then lib-or-null. */
  available: boolean | undefined;
  /** The opened library, shared across reloads. */
  lib: Library<typeof FLOCK_SYMBOLS> | null | undefined;
}

declare global {
  // eslint-disable-next-line no-var
  var __kabmoFlock: FlockHost | undefined;
}

function host(): FlockHost {
  return (globalThis.__kabmoFlock ??= { held: new Map(), available: undefined, lib: undefined });
}

/** libc with `flock`, or null when this host has none. Cached for the process. */
function libc(): Library<typeof FLOCK_SYMBOLS> | null {
  const state = host();
  if (state.lib !== undefined) return state.lib;
  state.lib = null;
  if (process.platform === 'win32') return state.lib;
  for (const name of LIBC_NAMES) {
    try {
      state.lib = dlopen(name, FLOCK_SYMBOLS);
      return state.lib;
    } catch {
      // Try the next name; a host without any of them keeps the null answer.
    }
  }
  return state.lib;
}

/**
 * True when `flock(2)` actually works here — the symbol resolving is not
 * enough, because a filesystem can answer `ENOLCK`. Probed once, on a
 * throwaway file, so a caller can pick its mechanism up front instead of
 * discovering mid-wait that the syscall never works.
 */
export function flockAvailable(): boolean {
  const state = host();
  if (state.available !== undefined) return state.available;
  state.available = false;
  const symbols = libc();
  if (!symbols) return false;
  const probePath = `${process.env.TMPDIR ?? '/tmp'}/kabmo-flock-${process.pid}`;
  let fd: number | null = null;
  try {
    fd = fs.openSync(probePath, 'a');
    const ok = symbols.symbols.flock(fd, LOCK_EX | LOCK_NB) === 0;
    fs.closeSync(fd);
    fd = null;
    fs.rmSync(probePath, { force: true });
    if (!ok) {
      // The probe file was somehow already locked — treat the capability as
      // unproven rather than reporting a lock we do not hold.
      state.lib = null;
      return false;
    }
    state.available = true;
    return true;
  } catch {
    state.lib = null;
    return false;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // Already closed.
      }
    }
  }
}

export interface FlockHandle {
  /** Release the lease. Idempotent. */
  release: () => void;
}

/**
 * Take `LOCK_EX | LOCK_NB` on `lockPath`, or null when another process holds
 * it. Returns null too when `flock` is unavailable — callers must then use
 * their own mechanism.
 *
 * The fd is kept open for as long as the lease lives: closing it is what
 * releases the lock, and the kernel does the same on process death.
 */
export function tryFlock(lockPath: string): FlockHandle | null {
  const state = host();
  const existing = state.held.get(lockPath);
  if (existing) {
    // Re-entrant within one process: flock is per open-file-description, so a
    // second fd here would block against our own lock.
    existing.refs += 1;
    return { release: () => releaseFlock(lockPath) };
  }
  const symbols = libc();
  if (!symbols) return null;
  let fd: number;
  try {
    // `a` creates it when absent and never truncates; the file's content is
    // irrelevant (the inode is the lock), but the PID is useful when a human
    // looks at the directory.
    fd = fs.openSync(lockPath, 'a');
  } catch {
    return null;
  }
  let acquired = false;
  try {
    acquired = symbols.symbols.flock(fd, LOCK_EX | LOCK_NB) === 0;
  } catch {
    acquired = false;
  }
  if (!acquired) {
    try {
      fs.closeSync(fd);
    } catch {
      // Already closed.
    }
    return null;
  }
  try {
    fs.writeFileSync(fd, String(process.pid));
  } catch {
    // Informational only.
  }
  state.held.set(lockPath, { fd, refs: 1 });
  return { release: () => releaseFlock(lockPath) };
}

function releaseFlock(lockPath: string): void {
  const state = host();
  const entry = state.held.get(lockPath);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs > 0) return;
  state.held.delete(lockPath);
  try {
    fs.closeSync(entry.fd);
  } catch {
    // Already closed; the kernel released the lock either way.
  }
}
