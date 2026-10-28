/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * macOS process probe: `libproc` + `sysctl`, no subprocess.
 *
 * `ps -ax` answers the same questions, but it costs a process spawn and a full
 * process-table scan per snapshot — measured at ~32 ms here, against ~0.001 ms
 * for the direct calls — and the CLI's `waitForProcessExit` polls liveness every
 * 100 ms. These are the same APIs `ps` itself uses.
 *
 * `sysctl(KERN_PROC_PID)` is the liveness source rather than
 * `proc_pidinfo(PROC_PIDTBSDINFO)`: it answers for a ZOMBIE (which `proc_pidinfo`
 * refuses, returning 0 — verified) and for root-owned PIDs, so one call covers
 * liveness and the zombie distinction for every PID.
 *
 * Every entry point tolerates failure: a PID that vanished between two calls
 * makes the syscall report zero bytes, which is "not alive", and a sandbox that
 * denies the call degrades to signal 0 rather than throwing.
 *
 * The libraries are opened on the FIRST CALL rather than at module load, so
 * merely importing this module — which happens on every platform, whatever
 * `index.ts` dispatches to — cannot fail. See `bindLibs`.
 */

import { dlopen, FFIType, ptr } from 'bun:ffi';
import type { FFIFunction, Library } from 'bun:ffi';

import type { ProcessLiveness, ProcessProbe } from '@/server/lib/lifecycle/proc/types';

/** `sysctl` MIB pieces. */
const CTL_KERN = 1;
const KERN_PROC = 14;
const KERN_PROC_PID = 1;
const KERN_PROCARGS2 = 49;

/**
 * `struct kinfo_proc` up to its `p_stat` byte: `extern_proc`'s union (16),
 * `p_vmspace` (8), `p_sigacts` (8), `p_flag` (4). Verified against this
 * platform: a running process reads 2, a zombie reads 5, `launchd` reads 2.
 */
const KINFO_PROC_BYTES = 648;
const P_STAT_OFFSET = 36;
/** Darwin `p_stat` values. */
const SZOMB = 5;
/** `p_stat` values that mean "exited but not yet reaped". */
const SZOMB_LIKE = new Set([SZOMB, 6 /* SDEAD */]);

/**
 * Scratch for the `sysctl(KERN_PROC_PID)` call below, at module scope.
 *
 * One `isProcessAlive` asks this question twice (liveness then zombie), and
 * `getProcessState` asks it twice more — so the buffers are reused rather than
 * reallocated per call, the same reasoning as `bsdInfo` further down. Safe
 * because the whole probe is synchronous: no `await` can interleave a caller.
 */
const procMib = new Int32Array([CTL_KERN, KERN_PROC, KERN_PROC_PID, 0]);
const procSize = new BigUint64Array([BigInt(KINFO_PROC_BYTES)]);
const procBuffer = new Uint8Array(KINFO_PROC_BYTES);

/** Upper bound on a command line block; the kernel truncates instead. */
const ARGV_BUFFER_BYTES = 262_144;
const PATH_BUFFER_BYTES = 4096;

/**
 * The two Darwin libraries and their symbols, opened on the first probe call.
 *
 * `dlopen` at module scope runs on EVERY platform that imports this module —
 * `index.ts` picks a probe at load, but the import itself is what executes the
 * call, so the dispatch cannot prevent it. On Linux the Darwin dylibs do not
 * exist, so the import threw (`Failed to open library "libc.dylib"`) and took
 * down every module transitively importing the probe, tests included. Opening
 * them on first use keeps this module importable everywhere, and a host that
 * cannot open them gets the `null` degradation every method here promises.
 */
const LIBC_SYMBOLS = {
  sysctl: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u64], returns: FFIType.i32 },
} satisfies Record<string, FFIFunction>;

const LIBPROC_SYMBOLS = {
  proc_pidpath: { args: [FFIType.i32, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
  proc_pidinfo: { args: [FFIType.i32, FFIType.i32, FFIType.u64, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
} satisfies Record<string, FFIFunction>;

/** The opened Darwin libraries, as used by the probe below. */
interface DarwinLibs {
  libc: Library<typeof LIBC_SYMBOLS>;
  libproc: Library<typeof LIBPROC_SYMBOLS>;
}

let libs: DarwinLibs | null = null;
let libsAttempted = false;

/** Open the libraries once, and remember a host that cannot as unavailable. */
function bindLibs(): DarwinLibs | null {
  if (!libsAttempted) {
    libsAttempted = true;
    try {
      libs = {
        libc: dlopen('libc.dylib', LIBC_SYMBOLS),
        libproc: dlopen('/usr/lib/libproc.dylib', LIBPROC_SYMBOLS),
      };
    } catch {
      libs = null;
    }
  }
  return libs;
}

/** `PROC_PIDTBSDINFO` — the flavor whose reply is a `struct proc_bsdinfo`. */
const PROC_PIDTBSDINFO = 3;
/** `sizeof(struct proc_bsdinfo)`, verified against this platform. */
const BSDINFO_BYTES = 136;
/** `pbi_pid` — the identity check that guards every offset below. */
const BSDINFO_PID_OFFSET = 12;
/** `pbi_ppid` — the parent pid, read for the same reason `pbi_pid` is. */
const BSDINFO_PPID_OFFSET = 16;
/** `e_tpgid` — the field `ps -o tpgid=` prints. */
const BSDINFO_TPGID_OFFSET = 112;

/**
 * `p_stat` for a PID, `'absent'` when the kernel says no such process, or null
 * when the call itself failed.
 *
 * The two failure modes are NOT the same question and callers must not merge
 * them: `sysctl(KERN_PROC_PID)` answers rc=0 with a zero-length reply for a PID
 * that does not exist (verified: 999999 → rc 0, size 0), while a sandbox denies
 * the call with a non-zero rc. Reading the second as "dead" would let a sandbox
 * report a live server as gone.
 */
function procStatus(pid: number): number | 'absent' | null {
  const bound = bindLibs();
  if (bound === null) return null;
  procMib[3] = pid;
  procSize[0] = BigInt(KINFO_PROC_BYTES);
  try {
    if (bound.libc.symbols.sysctl(ptr(procMib), 4, ptr(procBuffer), ptr(procSize), null, 0) !== 0) return null;
  } catch {
    return null;
  }
  if (Number(procSize[0]) === 0) return 'absent';
  return procBuffer[P_STAT_OFFSET];
}

/**
 * Scratch for `foregroundGroup` below. One module-level buffer, safe because
 * the whole call is synchronous — no await can interleave another caller.
 */
const bsdInfo = new Uint8Array(BSDINFO_BYTES);
const bsdInfoView = new DataView(bsdInfo.buffer);

/**
 * Scratch for `executablePath` and `argvOf`, for the same reason as the buffers
 * above: `getProcessState` calls `commandLine`, which falls through argv to the
 * executable path, and each call used to allocate a fresh 256 KiB buffer plus
 * its views — 83 ms per 5000 probes against 24 ms reusing them. The decoder is
 * hoisted for the same reason. Safe because the whole probe is synchronous.
 */
const pathBuffer = new Uint8Array(PATH_BUFFER_BYTES);
const argvMib = new Int32Array([CTL_KERN, KERN_PROCARGS2, 0]);
const argvSize = new BigUint64Array([BigInt(ARGV_BUFFER_BYTES)]);
const argvBuffer = new Uint8Array(ARGV_BUFFER_BYTES);
const argvView = new DataView(argvBuffer.buffer);
const utf8Decoder = new TextDecoder();

/**
 * Executable path, or null. Also answers for root-owned PIDs (verified: pid 1 →
 * `/sbin/launchd`), which is what makes it the identity fallback when argv is
 * denied.
 */
function executablePath(pid: number): string | null {
  const bound = bindLibs();
  if (bound === null) return null;
  try {
    const written = bound.libproc.symbols.proc_pidpath(pid, ptr(pathBuffer), pathBuffer.length);
    return written > 0 ? utf8Decoder.decode(pathBuffer.subarray(0, written)) : null;
  } catch {
    return null;
  }
}

/**
 * argv of a live PID via `KERN_PROCARGS2`, or null.
 *
 * The block is laid out as: `argc` (i32), the executable path (NUL-terminated),
 * padding NULs, then `argc` NUL-terminated arguments. Denied for root-owned
 * PIDs, which is why `commandLine` also consults the executable path.
 */
function argvOf(pid: number): string[] | null {
  const bound = bindLibs();
  if (bound === null) return null;
  argvMib[2] = pid;
  argvSize[0] = BigInt(ARGV_BUFFER_BYTES);
  try {
    if (bound.libc.symbols.sysctl(ptr(argvMib), 3, ptr(argvBuffer), ptr(argvSize), null, 0) !== 0) return null;
  } catch {
    return null;
  }

  const length = Number(argvSize[0]);
  if (length <= 4) return null;
  const argc = argvView.getInt32(0, true);
  let cursor = 4;
  while (cursor < length && argvBuffer[cursor] !== 0) cursor += 1;
  while (cursor < length && argvBuffer[cursor] === 0) cursor += 1;

  const args: string[] = [];
  for (let index = 0; index < argc && cursor < length; index += 1) {
    let end = cursor;
    while (end < length && argvBuffer[end] !== 0) end += 1;
    args.push(utf8Decoder.decode(argvBuffer.subarray(cursor, end)));
    cursor = end + 1;
  }
  return args;
}

function signalAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the PID exists, we may not signal it (root-owned, another user).
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Liveness in one lookup, for both the probe and its own `isAlive`/`isZombie`
 * shims. A method calling `this` would break the moment a caller destructured
 * the probe, and the session registry does pass probes around by reference.
 */
function darwinLiveness(pid: number): ProcessLiveness {
  const status = procStatus(pid);
  if (status === 'absent') return 'dead';
  if (status !== null) return SZOMB_LIKE.has(status) ? 'zombie' : 'alive';
  // The syscall itself failed (sandbox). A path or a signal still separates
  // "exists" from "gone" — a path read answers for root-owned PIDs, and signal
  // 0 answers for the rest — so only a PID that fails both is reported dead.
  // Anything else is `unknown`, which callers treat as alive-but-unverified.
  if (executablePath(pid) !== null || signalAlive(pid)) return 'alive';
  return 'unknown';
}

export const darwinProbe: ProcessProbe = {
  commandLine(pid) {
    const args = argvOf(pid);
    if (args && args.length > 0) return args.join(' ');
    return executablePath(pid);
  },
  liveness: darwinLiveness,
  isAlive(pid) {
    // `procStatus` already reports a zombie as not-alive, so the old
    // `isAlive && !isZombie` pair asked it twice for one answer.
    const liveness = darwinLiveness(pid);
    // `unknown` keeps the previous fallback's bias: a sandboxed host must not
    // make a live server look dead.
    return liveness === 'alive' || liveness === 'unknown';
  },
  isZombie(pid) {
    return darwinLiveness(pid) === 'zombie';
  },
  /**
   * `e_tpgid` — the field `ps -o tpgid=` prints. `proc_pidinfo` is the cheap
   * route to it (measured ~0.9 µs against ~10 ms for the subprocess).
   *
   * The reply's own `pbi_pid` is checked against the requested pid before
   * `e_tpgid` is trusted: a struct-layout drift on a future macOS would
   * otherwise hand back a garbage group, and a wrong "busy" answer makes the
   * terminal cap refuse an attach. Returning null keeps the caller on `ps`.
   */
  foregroundGroup(pid) {
    const bound = bindLibs();
    if (bound === null) return null;
    let written = 0;
    try {
      written = bound.libproc.symbols.proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, ptr(bsdInfo), BSDINFO_BYTES);
    } catch {
      return null;
    }
    if (written < BSDINFO_BYTES) return null;
    if (bsdInfoView.getUint32(BSDINFO_PID_OFFSET, true) !== pid) return null;
    return bsdInfoView.getUint32(BSDINFO_TPGID_OFFSET, true);
  },
  /**
   * `pbi_ppid` — the parent pid, from the SAME `proc_bsdinfo` reply
   * `foregroundGroup` reads. Verified against this platform: a process's own
   * `pbi_ppid` equals its `getppid()`.
   */
  parentPid(pid) {
    const bound = bindLibs();
    if (bound === null) return null;
    let written = 0;
    try {
      written = bound.libproc.symbols.proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, ptr(bsdInfo), BSDINFO_BYTES);
    } catch {
      return null;
    }
    if (written < BSDINFO_BYTES) return null;
    if (bsdInfoView.getUint32(BSDINFO_PID_OFFSET, true) !== pid) return null;
    const ppid = bsdInfoView.getUint32(BSDINFO_PPID_OFFSET, true);
    return ppid > 0 ? ppid : null;
  },
};
