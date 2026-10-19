/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Which process holds an open descriptor on a file, found without a subprocess.
 *
 * A `flock` answers "is this lease held" but names no owner, and Kabmo
 * needs the owner to relay a request to the instance serving it. `lsof -t`
 * answers exactly this question, but it spawns — and this module exists to ask
 * the same question through the platform's own APIs, which is how the rest of
 * the server already reads process state (`lifecycle/proc`).
 *
 * macOS walks the process table with `libproc` (`proc_listpids` →
 * `proc_pidinfo(PROC_PIDLISTFDS)` → `proc_pidfdinfo(PROC_PIDFDVNODEPATHINFO)`),
 * Linux reads `/proc/<pid>/fd` and resolves each link. Both are the mechanisms
 * `lsof` itself uses; the macOS path is FFI, the Linux path is plain file reads.
 *
 * Verified against a live omp process: the lease file's descriptor is reported
 * at ~7 ms for the whole process table (665 processes here), and the pid it
 * names is the process `lsof -t` also reports.
 */

import fs from 'fs';
import { dlopen, FFIType, ptr, type FFIFunction, type Library } from 'bun:ffi';

const LIBPROC_SYMBOLS = {
  proc_listpids: { args: [FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
  proc_pidinfo: { args: [FFIType.i32, FFIType.i32, FFIType.u64, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
  proc_pidfdinfo: { args: [FFIType.i32, FFIType.i32, FFIType.i32, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
} satisfies Record<string, FFIFunction>;

/** `PROC_ALL_PIDS`, `PROC_PIDLISTFDS`, `PROX_FDTYPE_VNODE`, `PROC_PIDFDVNODEPATHINFO`. */
const PROC_ALL_PIDS = 1;
const PROC_PIDLISTFDS = 1;
const PROX_FDTYPE_VNODE = 1;
const PROC_PIDFDVNODEPATHINFO = 2;

/** `struct proc_fdinfo` — an fd number and its type. */
const FDINFO_BYTES = 8;
/**
 * `struct vnode_fdinfowithpath`: `proc_fileinfo` (24) + `vnode_info` (152) +
 * `vip_path[1024]`. The path starts at 176 and is NUL-terminated.
 */
const FD_PATH_OFFSET = 176;
const FD_PATH_BYTES = 1024;
const FD_PATHINFO_BYTES = FD_PATH_OFFSET + FD_PATH_BYTES;

const PID_BUFFER_BYTES = 4 * 16_384;
const FD_LIST_BYTES = FDINFO_BYTES * 8_192;

let libproc: Library<typeof LIBPROC_SYMBOLS> | null | undefined;

function bindLibproc(): Library<typeof LIBPROC_SYMBOLS> | null {
  if (libproc !== undefined) return libproc;
  if (process.platform !== 'darwin') {
    libproc = null;
    return null;
  }
  try {
    libproc = dlopen('/usr/lib/libproc.dylib', LIBPROC_SYMBOLS);
  } catch {
    libproc = null;
  }
  return libproc;
}

/** Every live pid on macOS, via `proc_listpids`. */
function darwinPids(lib: Library<typeof LIBPROC_SYMBOLS>): number[] {
  const buffer = new Uint8Array(PID_BUFFER_BYTES);
  const bytes = lib.symbols.proc_listpids(PROC_ALL_PIDS, 0, ptr(buffer), buffer.byteLength);
  if (bytes <= 0) return [];
  const view = new DataView(buffer.buffer);
  const pids: number[] = [];
  for (let offset = 0; offset + 4 <= bytes; offset += 4) {
    const pid = view.getInt32(offset, true);
    if (pid > 0) pids.push(pid);
  }
  return pids;
}

/** The holder pid on macOS, or null when no process has `target` open. */
function darwinHolderPid(target: string): number | null {
  const lib = bindLibproc();
  if (lib === null) return null;
  const fdBuf = new Uint8Array(FD_LIST_BYTES);
  const pathBuf = new Uint8Array(FD_PATHINFO_BYTES);
  const decoder = new TextDecoder();
  for (const pid of darwinPids(lib)) {
    const fdBytes = lib.symbols.proc_pidinfo(pid, PROC_PIDLISTFDS, 0n, ptr(fdBuf), fdBuf.byteLength);
    if (fdBytes <= 0) continue;
    const view = new DataView(fdBuf.buffer);
    for (let offset = 0; offset + FDINFO_BYTES <= fdBytes; offset += FDINFO_BYTES) {
      if (view.getUint32(offset + 4, true) !== PROX_FDTYPE_VNODE) continue;
      const fd = view.getInt32(offset, true);
      const size = lib.symbols.proc_pidfdinfo(pid, fd, PROC_PIDFDVNODEPATHINFO, ptr(pathBuf), pathBuf.byteLength);
      if (size <= 0) continue;
      const bytes = pathBuf.subarray(FD_PATH_OFFSET, FD_PATH_OFFSET + FD_PATH_BYTES);
      const end = bytes.indexOf(0);
      if (decoder.decode(bytes.subarray(0, end === -1 ? bytes.length : end)) === target) return pid;
    }
  }
  return null;
}

/** The holder pid on Linux, via `/proc/<pid>/fd` links. */
function linuxHolderPid(target: string): number | null {
  let pids: string[];
  try {
    pids = fs.readdirSync('/proc');
  } catch {
    return null;
  }
  for (const name of pids) {
    const pid = Number(name);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    let fds: string[];
    try {
      fds = fs.readdirSync(`/proc/${pid}/fd`);
    } catch {
      // A process that exited mid-walk, or one we may not inspect.
      continue;
    }
    for (const fd of fds) {
      try {
        if (fs.readlinkSync(`/proc/${pid}/fd/${fd}`) === target) return pid;
      } catch {
        // Race with close/exit: keep walking.
      }
    }
  }
  return null;
}

/**
 * Pid of the process holding an open descriptor on `target`, or null when none
 * does (or this platform cannot answer — Windows).
 *
 * The comparison is against the CANONICAL path: a descriptor reports the path
 * the kernel resolved, so a target reached through a symlink (macOS `/tmp` →
 * `/private/tmp`, or a symlinked home) would never match its own literal
 * spelling. One `realpath` removes that class of false negative.
 */
export function fileHolderPid(target: string): number | null {
  let canonical: string;
  try {
    canonical = fs.realpathSync(target);
  } catch {
    // The file does not exist: no descriptor can name it.
    return null;
  }
  if (process.platform === 'darwin') return darwinHolderPid(canonical);
  if (process.platform === 'linux') return linuxHolderPid(canonical);
  return null;
}
