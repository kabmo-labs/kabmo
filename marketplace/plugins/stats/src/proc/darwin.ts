/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * macOS: `libproc` + `sysctl`, no subprocess.
 *
 * Five calls per process, all through the same libraries the chamber's own
 * liveness probe already opens:
 *
 * | Question | Call | Measured |
 * |---|---|---|
 * | which pids exist | `proc_listpids(PROC_ALL_PIDS)` | two calls: a size probe, then the read |
 * | ppid, start time | `proc_pidinfo(PROC_PIDTBSDINFO)` | 136-byte reply, ppid at offset 16 |
 * | rss, cpu, threads | `proc_pidinfo(PROC_PIDTASKINFO)` | 96-byte reply |
 * | cwd | `proc_pidinfo(PROC_PIDVNODEPATHINFO)` | 152-byte prefix, `vip_path` at 152 |
 * | argv | `sysctl(KERN_PROCARGS2)` | 256 KB ceiling, kernel truncates |
 *
 * Two traps, both measured on this machine and both silent when wrong:
 *
 * - **`pti_total_user`/`pti_total_system` are mach absolute-time ticks, not
 *   nanoseconds.** `mach_timebase_info` reports 125/3 here, so a tick is ~41 ns.
 *   Cross-checked against `ps`: a spin loop measured 1003.8 ms of CPU over
 *   1002 ms of wall.
 * - **`proc_pid_rusage` is a decoy for RSS.** It returns 0 and its resident
 *   field reads zero for a 200 MB allocation on this host, while
 *   `pti_resident_size` matched `ps rss` and Bun's `process.memoryUsage().rss`
 *   to within 0.3%. `taskinfo` is the call that works.
 *
 * A process that exits mid-sweep makes every one of these fail; each is
 * tolerated and the row is simply absent, which is the honest outcome.
 */

import { dlopen, FFIType, ptr } from 'bun:ffi';
import type { FFIFunction, Library } from 'bun:ffi';

import type { ProcProbe, ProcessInfo } from './types';

const LIBPROC_SYMBOLS = {
  proc_listpids: { args: [FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
  proc_pidinfo: { args: [FFIType.i32, FFIType.i32, FFIType.u64, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
} satisfies Record<string, FFIFunction>;

const LIBC_SYMBOLS = {
  sysctl: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u64], returns: FFIType.i32 },
  mach_timebase_info: { args: [FFIType.ptr], returns: FFIType.i32 },
} satisfies Record<string, FFIFunction>;

/** `PROC_ALL_PIDS` — every pid on the system. */
const PROC_ALL_PIDS = 1;
/** The flavor whose reply is a `struct proc_bsdinfo`. */
const PROC_PIDTBSDINFO = 3;
/** The flavor whose reply is a `struct proc_taskinfo` — the one with CPU and RSS. */
const PROC_PIDTASKINFO = 4;
/** `sizeof(struct proc_bsdinfo)`, verified against this platform. */
const BSDINFO_BYTES = 136;
/** `sizeof(struct proc_taskinfo)`, verified against this platform. */
const TASKINFO_BYTES = 96;
/** Identity guard, so a struct-layout drift cannot hand back another process. */
const BSDINFO_PID_OFFSET = 12;
const BSDINFO_PPID_OFFSET = 16;
/**
 * `pbi_start_tvsec` / `pbi_start_tvusec` — when the process started.
 *
 * Verified against `ps -o lstart=` on this host: the seconds field alone
 * matched to the second, and the usec field is what keeps a burst of children
 * (a broker plus its daemons) from all reading the same age.
 */
const BSDINFO_START_SEC_OFFSET = 120;
const BSDINFO_START_USEC_OFFSET = 128;
/** `pti_resident_size`, `pti_total_user`, `pti_total_system`, `pti_threadnum`. */
const TASKINFO_RSS_OFFSET = 8;
const TASKINFO_USER_OFFSET = 16;
const TASKINFO_SYSTEM_OFFSET = 24;
const TASKINFO_THREADS_OFFSET = 84;
/** `PROC_PIDVNODEPATHINFO`, and `pvi_cdir.vip_path` inside its reply. */
const PROC_PIDVNODEPATHINFO = 9;
/**
 * `sizeof(struct proc_vnodepathinfo)` — TWO `vnode_info_path`s (the cwd and the
 * root dir), so 2 × (152 + 1024) = 2352. A buffer of one `vnode_info_path` is
 * too small and the call answers 0, which reads as "no cwd" for every process.
 */
const VNODE_PATH_BYTES = 2 * (152 + 1024);
const CWD_PATH_OFFSET = 152;

/** `sysctl` MIB pieces for a process's argv block. */
const CTL_KERN = 1;
const KERN_PROCARGS2 = 49;
/** Upper bound on the argv block; the kernel truncates rather than failing. */
const ARGV_BUFFER_BYTES = 262_144;

interface DarwinLibs {
  libproc: Library<typeof LIBPROC_SYMBOLS>;
  libc: Library<typeof LIBC_SYMBOLS>;
}

let libs: DarwinLibs | null = null;
let libsAttempted = false;

/** Open the libraries once; a host that cannot gets the unsupported answer. */
function bindLibs(): DarwinLibs | null {
  if (libsAttempted) return libs;
  libsAttempted = true;
  try {
    libs = {
      libproc: dlopen('/usr/lib/libproc.dylib', LIBPROC_SYMBOLS),
      libc: dlopen('libc.dylib', LIBC_SYMBOLS),
    };
  } catch {
    libs = null;
  }
  return libs;
}

/**
 * Nanoseconds per mach absolute-time tick, or 1 when it cannot be read.
 *
 * Read once: the timebase is a property of the host, not of a process. Falling
 * back to 1 keeps a host where the symbol is missing reporting CPU in ticks —
 * wrong by a constant factor, but never zero and never NaN.
 */
let nsPerTick: number | null = null;
function timebase(bound: DarwinLibs): number {
  if (nsPerTick !== null) return nsPerTick;
  nsPerTick = 1;
  try {
    const scratch = new Uint32Array(2);
    if (bound.libc.symbols.mach_timebase_info(ptr(scratch)) === 0 && scratch[1] > 0) {
      nsPerTick = scratch[0] / scratch[1];
    }
  } catch {
    // Keep the 1:1 fallback.
  }
  return nsPerTick;
}

/** Scratch buffers, module scope: every call here is synchronous. */
const pidBuffer = new Uint8Array(4 * 8192);
const bsdInfo = new Uint8Array(BSDINFO_BYTES);
const bsdView = new DataView(bsdInfo.buffer);
const taskInfo = new Uint8Array(TASKINFO_BYTES);
const taskView = new DataView(taskInfo.buffer);
const argvBuffer = new Uint8Array(ARGV_BUFFER_BYTES);
const argvView = new DataView(argvBuffer.buffer);
const argvMib = new Int32Array([CTL_KERN, KERN_PROCARGS2, 0]);
const argvSize = new BigUint64Array([BigInt(ARGV_BUFFER_BYTES)]);
const cwdBuffer = new Uint8Array(VNODE_PATH_BYTES);
const decoder = new TextDecoder();

/** Every pid on the system, via the documented two-call sizing pattern. */
function allPids(bound: DarwinLibs): number[] {
  const needed = bound.libproc.symbols.proc_listpids(PROC_ALL_PIDS, 0, null, 0);
  if (needed <= 0) return [];
  const size = Math.min(needed, pidBuffer.length);
  const written = bound.libproc.symbols.proc_listpids(PROC_ALL_PIDS, 0, ptr(pidBuffer), size);
  if (written <= 0) return [];
  // Both calls answer in BYTES — `proc_listchildpids` answers a pid COUNT
  // instead, and assuming that shape here would read a quarter of the table.
  const count = Math.floor(written / 4);
  const out: number[] = [];
  const view = new Int32Array(pidBuffer.buffer, 0, count);
  for (let i = 0; i < count; i++) {
    const pid = view[i];
    if (pid > 0) out.push(pid);
  }
  return out;
}

/** `{ ppid, startedAt }` for one pid, or null. */
function parentOf(bound: DarwinLibs, pid: number): { ppid: number; startedAt: number } | null {
  const written = bound.libproc.symbols.proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, ptr(bsdInfo), BSDINFO_BYTES);
  if (written < BSDINFO_BYTES) return null;
  // The reply's own pid is checked before any offset is trusted: a struct drift
  // would otherwise attribute one process's parent to another.
  if (bsdView.getUint32(BSDINFO_PID_OFFSET, true) !== pid) return null;
  const seconds = Number(bsdView.getBigUint64(BSDINFO_START_SEC_OFFSET, true));
  const micros = Number(bsdView.getBigUint64(BSDINFO_START_USEC_OFFSET, true));
  return {
    ppid: bsdView.getUint32(BSDINFO_PPID_OFFSET, true),
    // 0 is the honest answer for a start time the kernel did not report; a
    // fabricated `Date.now()` would read as "just started" on every row.
    startedAt: seconds > 0 ? seconds * 1000 + Math.floor(micros / 1000) : 0,
  };
}

/** The process's working directory, or null. */
function cwdOf(bound: DarwinLibs, pid: number): string | null {
  if (bound.libproc.symbols.proc_pidinfo(pid, PROC_PIDVNODEPATHINFO, 0, ptr(cwdBuffer), VNODE_PATH_BYTES) <= 0) {
    return null;
  }
  const end = cwdBuffer.indexOf(0, CWD_PATH_OFFSET);
  const stop = end === -1 ? cwdBuffer.length : end;
  const path = decoder.decode(cwdBuffer.subarray(CWD_PATH_OFFSET, stop));
  return path.startsWith('/') ? path : null;
}

/** `{ rss, cpuNs, threads }` for one pid, or null. */
function usageOf(bound: DarwinLibs, pid: number): { rss: number; cpuNs: number; threads: number } | null {
  if (bound.libproc.symbols.proc_pidinfo(pid, PROC_PIDTASKINFO, 0, ptr(taskInfo), TASKINFO_BYTES) !== TASKINFO_BYTES) {
    return null;
  }
  const ticks = Number(taskView.getBigUint64(TASKINFO_USER_OFFSET, true)) + Number(taskView.getBigUint64(TASKINFO_SYSTEM_OFFSET, true));
  return {
    rss: Number(taskView.getBigUint64(TASKINFO_RSS_OFFSET, true)),
    cpuNs: ticks * timebase(bound),
    threads: taskView.getInt32(TASKINFO_THREADS_OFFSET, true),
  };
}

/**
 * argv for one pid, or null.
 *
 * The reply is `argc`, the executable path, NUL padding, then `argc` NUL-
 * terminated strings. The padding loop is not optional: the kernel pads to a
 * word boundary, and skipping only one NUL leaves the first argument reading as
 * an empty string.
 *
 * `sysctl` itself fails for pid 1 and for a process that just exited (measured),
 * which is the null answer rather than an error.
 */
function argvOf(bound: DarwinLibs, pid: number): string[] | null {
  argvMib[2] = pid;
  argvSize[0] = BigInt(ARGV_BUFFER_BYTES);
  if (bound.libc.symbols.sysctl(ptr(argvMib), 3, ptr(argvBuffer), ptr(argvSize), null, 0n) !== 0) return null;
  const size = Number(argvSize[0]);
  if (size <= 4) return null;
  const argc = argvView.getInt32(0, true);
  let offset = 4;
  while (offset < size && argvBuffer[offset] !== 0) offset += 1;
  while (offset < size && argvBuffer[offset] === 0) offset += 1;
  const out: string[] = [];
  for (let i = 0; i < argc && offset < size; i += 1) {
    const start = offset;
    while (offset < size && argvBuffer[offset] !== 0) offset += 1;
    out.push(decoder.decode(argvBuffer.subarray(start, offset)));
    while (offset < size && argvBuffer[offset] === 0) offset += 1;
  }
  return out.length > 0 ? out : null;
}

export const darwinProbe: ProcProbe = {
  name: 'darwin',
  supported: true,
  list() {
    const bound = bindLibs();
    if (!bound) {
      return [];
    }
    const out: ProcessInfo[] = [];
    for (const pid of allPids(bound)) {
      const usage = usageOf(bound, pid);
      if (!usage) continue;
      const parent = parentOf(bound, pid);
      out.push({
        pid,
        ppid: parent?.ppid ?? 0,
        rss: usage.rss,
        cpuNs: usage.cpuNs,
        threads: usage.threads,
        argv: argvOf(bound, pid),
        cwd: cwdOf(bound, pid),
        startedAt: parent?.startedAt ?? 0,
      });
    }
    return out;
  },
};
