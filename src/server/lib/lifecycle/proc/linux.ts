/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Linux process probe: `/proc`, no subprocess and no FFI.
 *
 * `procfs` already holds everything `ps` reads, so this is both faster and
 * immune to a missing binary in minimal containers (where the previous `ps`
 * snapshot simply came back empty and identity degraded to `unknown`).
 *
 * `stat` is parsed from the LAST `)` because field 2 is the executable name in
 * parentheses and may itself contain spaces and parentheses.
 */

import fs from 'fs';

import type { ProcessProbe } from '@/server/lib/lifecycle/proc/types';

/** Field 3 of `/proc/<pid>/stat`, 1-indexed, once the comm field is stripped. */
const STATE_FIELD = 0;
const ZOMBIE_STATES = new Set(['Z', 'X']);

function readFile(path: string): string | null {
  try {
    return fs.readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** `/proc/<pid>/stat` fields after the `(comm)` column, or null. */
function statTail(pid: number): string[] | null {
  const raw = readFile(`/proc/${pid}/stat`);
  if (raw === null) return null;
  const close = raw.lastIndexOf(')');
  if (close === -1) return null;
  return raw.slice(close + 1).trim().split(/\s+/);
}

/**
 * Index of tpgid in `statTail`'s output.
 *
 * `/proc/<pid>/stat` numbers it 8 (1-indexed), and `statTail` has already
 * dropped fields 1 (`pid`) and 2 (`(comm)`) — so the index is 8 - 3 = 5. At 6
 * this read field 9, `flags`, which answered every live process with 0x400000
 * instead of a process group.
 */
const TPGID_FIELD = 5;

/**
 * `{ state, tpgid }` from ONE `/proc/<pid>/stat` read.
 *
 * `isZombie` and `foregroundGroup` both need this file, and the terminal cap
 * asks both about the same shell; reading it once per question instead of twice
 * is why the two are resolved together.
 */
function procStat(pid: number): { state: string; tpgid: number } | null {
  const fields = statTail(pid);
  if (fields === null) return null;
  const tpgid = Number(fields[TPGID_FIELD]);
  return { state: fields[STATE_FIELD], tpgid: Number.isFinite(tpgid) ? tpgid : 0 };
}

export const linuxProbe: ProcessProbe = {
  commandLine(pid) {
    const raw = readFile(`/proc/${pid}/cmdline`);
    if (raw === null) return null;
    // NUL-separated argv, with a trailing NUL; empty for a kernel thread.
    const args = raw.split('\0').filter((part) => part.length > 0);
    if (args.length > 0) return args.join(' ');
    // Kernel threads have no argv — `comm` is all the identity there is.
    return readFile(`/proc/${pid}/comm`)?.trim() || null;
  },
  liveness(pid) {
    // A `/proc` entry exists for a zombie too, so the state field is what
    // separates a corpse from a running process.
    const stat = procStat(pid);
    if (stat === null) {
      // No `stat` file: either the PID is gone or the read failed. `existsSync`
      // keeps the previous answer for a process with no readable stat.
      return fs.existsSync(`/proc/${pid}`) ? 'unknown' : 'dead';
    }
    return ZOMBIE_STATES.has(stat.state) ? 'zombie' : 'alive';
  },
  isAlive(pid) {
    // A `/proc` entry exists for a zombie too, so liveness is "the directory is
    // there"; `isZombie` is what separates a corpse from a running process.
    return fs.existsSync(`/proc/${pid}`);
  },
  isZombie(pid) {
    const stat = procStat(pid);
    return stat !== null && ZOMBIE_STATES.has(stat.state);
  },
  foregroundGroup(pid) {
    // Already read for `isZombie` on the same question, so this costs no extra
    // syscall beyond the file read itself.
    const stat = procStat(pid);
    return stat === null ? null : stat.tpgid;
  },
  parentPid(pid) {
    // `/proc/<pid>/stat` field 4 is the parent pid. `statTail` has dropped
    // fields 1 (`pid`) and 2 (`(comm)`), so it lands at index 1.
    const fields = statTail(pid);
    if (fields === null) return null;
    const ppid = Number(fields[1]);
    return Number.isInteger(ppid) && ppid > 0 ? ppid : null;
  },
};
