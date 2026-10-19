/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Two per-pid facts the sweep does not carry: the working directory, and the
 * session lease the process holds.
 *
 * Both answer a question `argv` cannot, and both are needed to name a row
 * honestly:
 *
 * - **cwd** names the project for a process whose argv does not. A `tsserver`,
 *   a Chromium helper and a `codegraph` MCP server all look alike in argv, and
 *   the directory they run in is the only thing that says which checkout they
 *   belong to. Measured: 381 pids in 1.76 ms.
 * - **the lease** is how a live session is told from a prewarmed host. argv is
 *   fixed at spawn (`buildSessionSpawnArgs('')` carries no `--resume`), so a
 *   host that ADOPTED a prewarm keeps the prewarm's argv forever — measured on
 *   this machine, three rows that read as idle prewarms were live sessions with
 *   titles and hundreds of messages. omp takes an OS `flock` on
 *   `<configRoot>/run/session-owners/<sessionId>.lock` for the life of the
 *   process that opened the session, so an open descriptor on that file IS the
 *   answer. Measured: 0.70 ms for 9 pids.
 *
 * ## Why a second libproc handle
 *
 * `darwin.ts` owns the whole-table sweep and its scratch buffers; this module
 * owns the two per-pid lookups. They open the same library, which the OS
 * refcounts, so the second `dlopen` costs a lookup and no memory. Folding these
 * into the sweep would make every pid pay for two calls only a handful need.
 *
 * The struct offsets are the ones `lease-holder.server.ts` in Kabmo's own
 * server already uses against this platform, which is why they are named rather
 * than re-derived here.
 */

import fs from 'node:fs';
import { dlopen, FFIType, ptr, type FFIFunction, type Library } from 'bun:ffi';

const LIBPROC_SYMBOLS = {
  proc_pidinfo: { args: [FFIType.i32, FFIType.i32, FFIType.u64, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
  proc_pidfdinfo: { args: [FFIType.i32, FFIType.i32, FFIType.i32, FFIType.ptr, FFIType.i32], returns: FFIType.i32 },
} satisfies Record<string, FFIFunction>;

/** `PROC_PIDVNODEPATHINFO` — the reply is a `struct proc_vnodepathinfo`. */
const PROC_PIDVNODEPATHINFO = 9;
/** `PROC_PIDLISTFDS` and the vnode fd type, for the lease walk. */
const PROC_PIDLISTFDS = 1;
const PROX_FDTYPE_VNODE = 1;
/** `PROC_PIDFDVNODEPATHINFO` — the reply is a `struct vnode_fdinfowithpath`. */
const PROC_PIDFDVNODEPATHINFO = 2;

/** `sizeof(struct proc_vnodepathinfo)`: TWO `vnode_info_path`s, cwd + root. */
const VNODE_PATH_BYTES = 2 * (152 + 1024);
/** `pvi_cdir.vip_path` — the cwd. Verified against this platform. */
const CWD_PATH_OFFSET = 152;
/** `struct vnode_fdinfowithpath`: `proc_fileinfo` (24) + `vnode_info` (152) + path. */
const FD_PATH_OFFSET = 176;
const FD_PATH_BYTES = 1024;
const FD_PATHINFO_BYTES = FD_PATH_OFFSET + FD_PATH_BYTES;
/** `struct proc_fdinfo` — an fd number and its type. */
const FDINFO_BYTES = 8;
const FD_LIST_BYTES = FDINFO_BYTES * 8_192;

/** The lease file name, which carries the session id. */
const LEASE_PATTERN = /\/session-owners\/([0-9a-f-]{36})\.lock$/;

let libproc: Library<typeof LIBPROC_SYMBOLS> | null | undefined;

/** Open libproc once; a host without it answers null for both questions. */
function bindLibproc(): Library<typeof LIBPROC_SYMBOLS> | null {
  if (libproc !== undefined) return libproc;
  try {
    libproc = dlopen('/usr/lib/libproc.dylib', LIBPROC_SYMBOLS);
  } catch {
    libproc = null;
  }
  return libproc;
}

const cwdBuffer = new Uint8Array(VNODE_PATH_BYTES);
const fdBuffers = { list: new Uint8Array(FD_LIST_BYTES), path: new Uint8Array(FD_PATHINFO_BYTES) };
const decoder = new TextDecoder();

/** A NUL-terminated string at `offset` of `buffer`, or null when empty. */
function stringAt(buffer: Uint8Array, offset: number, limit: number): string | null {
  const end = buffer.indexOf(0, offset);
  const stop = end === -1 || end > offset + limit ? offset + limit : end;
  const value = decoder.decode(buffer.subarray(offset, stop));
  return value.length > 0 ? value : null;
}

/** cwd on macOS, via `PROC_PIDVNODEPATHINFO`. */
function darwinCwd(pid: number): string | null {
  const lib = bindLibproc();
  if (lib === null) return null;
  const written = lib.symbols.proc_pidinfo(pid, PROC_PIDVNODEPATHINFO, 0n, ptr(cwdBuffer), cwdBuffer.byteLength);
  if (written <= 0) return null;
  const path = stringAt(cwdBuffer, CWD_PATH_OFFSET, 1024);
  return path && path.startsWith('/') ? path : null;
}

/** The session id in a lease this pid holds, or null. macOS, via the fd table. */
function darwinLease(pid: number): string | null {
  const lib = bindLibproc();
  if (lib === null) return null;
  const bytes = lib.symbols.proc_pidinfo(pid, PROC_PIDLISTFDS, 0n, ptr(fdBuffers.list), fdBuffers.list.byteLength);
  if (bytes <= 0) return null;
  const view = new DataView(fdBuffers.list.buffer);
  for (let offset = 0; offset + FDINFO_BYTES <= bytes; offset += FDINFO_BYTES) {
    if (view.getUint32(offset + 4, true) !== PROX_FDTYPE_VNODE) continue;
    const fd = view.getInt32(offset, true);
    const size = lib.symbols.proc_pidfdinfo(pid, fd, PROC_PIDFDVNODEPATHINFO, ptr(fdBuffers.path), fdBuffers.path.byteLength);
    if (size <= 0) continue;
    const path = stringAt(fdBuffers.path, FD_PATH_OFFSET, FD_PATH_BYTES);
    if (!path) continue;
    const match = LEASE_PATTERN.exec(path);
    if (match) return match[1];
  }
  return null;
}

/** cwd on Linux, via the `/proc/<pid>/cwd` symlink. */
function linuxCwd(pid: number): string | null {
  try {
    const path = fs.readlinkSync(`/proc/${pid}/cwd`);
    return path.startsWith('/') ? path : null;
  } catch {
    // Exited mid-sweep, or not ours to read.
    return null;
  }
}

/** The session id in a lease this pid holds, or null. Linux, via `/proc/<pid>/fd`. */
function linuxLease(pid: number): string | null {
  let fds: string[];
  try {
    fds = fs.readdirSync(`/proc/${pid}/fd`);
  } catch {
    return null;
  }
  for (const fd of fds) {
    try {
      const match = LEASE_PATTERN.exec(fs.readlinkSync(`/proc/${pid}/fd/${fd}`));
      if (match) return match[1];
    } catch {
      // Race with close/exit: keep walking.
    }
  }
  return null;
}

/**
 * The process's working directory, or null.
 *
 * The `ps` fallback platform answers null: `comm` is the only column it reads,
 * and there is no directory in it.
 */
export function cwdOf(pid: number): string | null {
  if (process.platform === 'darwin') return darwinCwd(pid);
  if (process.platform === 'linux') return linuxCwd(pid);
  return null;
}

/**
 * The session id whose lease this process holds, or null.
 *
 * Only an `omp` session host ever holds one, so a caller should gate on the
 * argv (`--mode rpc-ui`) before asking — the walk costs one `proc_pidinfo` per
 * open descriptor.
 */
export function leaseOfPid(pid: number): string | null {
  if (process.platform === 'darwin') return darwinLease(pid);
  if (process.platform === 'linux') return linuxLease(pid);
  return null;
}


