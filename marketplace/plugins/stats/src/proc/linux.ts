/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Linux: `/proc`, no subprocess and no FFI.
 *
 * Two files per process, and both are chosen for a measured reason:
 *
 * | Question | File | Measured |
 * |---|---|---|
 * | ppid, utime, stime | `/proc/<pid>/stat` | fields after the `(comm)` column |
 * | rss, threads | `/proc/<pid>/status` | `VmRSS:` kB, `Threads:` |
 * | argv | `/proc/<pid>/cmdline` | NUL-separated |
 *
 * **`status` rather than `statm` for RSS.** `statm` is a page count, and the
 * page size is not a constant: 4096 in a container against 16384 on an
 * Apple-silicon host running one. `VmRSS` is already in kB, so the conversion
 * has no page-size question in it at all — and `status` measured FASTER
 * (0.47 ms against 0.58 ms per sweep over 61 processes), so nothing is traded
 * for the correctness.
 *
 * **`stat` is parsed from the LAST `)`.** Field 2 is the executable name in
 * parentheses and may itself contain spaces and parentheses, so splitting from
 * the left puts every later index at the mercy of the process's own name.
 *
 * CPU comes from `utime`/`stime` in `CLK_TCK` units — 100 on every Linux this
 * was measured on, and read from `getconf` rather than assumed. Verified
 * against a spin loop: 101.0% where `ps` printed 100.0.
 */

import fs from 'node:fs';

import type { ProcProbe, ProcessInfo } from './types';

/** `CLK_TCK` — the unit of `utime`/`stime`. */
const DEFAULT_CLK_TCK = 100;

/**
 * The host's own `CLK_TCK`, or the constant.
 *
 * Read once from `getconf` because it is a kernel build setting rather than a
 * fixed number: an architecture with a different HZ would otherwise have every
 * CPU figure wrong by that ratio. A host without `getconf` keeps the default,
 * which is what every distribution this runs on reports.
 */
let clkTck: number | null = null;
function ticksPerSecond(): number {
  if (clkTck !== null) return clkTck;
  clkTck = DEFAULT_CLK_TCK;
  try {
    const probe = Bun.spawnSync(['getconf', 'CLK_TCK']);
    const parsed = Number(probe.stdout.toString().trim());
    if (Number.isFinite(parsed) && parsed > 0) clkTck = parsed;
  } catch {
    // Keep the default.
  }
  return clkTck;
}

function readFile(path: string): string | null {
  try {
    return fs.readFileSync(path, 'utf8');
  } catch {
    // The process exited mid-sweep, or is not ours to read.
    return null;
  }
}

/** Fields after the `(comm)` column of `/proc/<pid>/stat`, or null. */
function statTail(pid: number): string[] | null {
  const raw = readFile(`/proc/${pid}/stat`);
  if (raw === null) return null;
  const close = raw.lastIndexOf(')');
  if (close === -1) return null;
  return raw.slice(close + 1).trim().split(/\s+/);
}

/** `{ ppid, cpuNs, startedAt }` from one `stat` read, or null. */
function statOf(pid: number): { ppid: number; cpuNs: number; startedAt: number } | null {
  const fields = statTail(pid);
  if (!fields) return null;
  // `statTail` has dropped fields 1 (`pid`) and 2 (`(comm)`), so 1-indexed
  // field N lands at index N - 3.
  const ppid = Number(fields[1]);
  const utime = Number(fields[11]);
  const stime = Number(fields[12]);
  // Field 22, `starttime`, in `CLK_TCK` ticks since BOOT — not an epoch.
  const startTicks = Number(fields[19]);
  if (!Number.isFinite(ppid) || !Number.isFinite(utime) || !Number.isFinite(stime)) return null;
  const nsPerTick = 1e9 / ticksPerSecond();
  return {
    ppid: ppid > 0 ? ppid : 0,
    cpuNs: (utime + stime) * nsPerTick,
    startedAt: bootMs() + (Number.isFinite(startTicks) ? (startTicks / ticksPerSecond()) * 1000 : 0),
  };
}

/**
 * Boot time in epoch milliseconds, or 0 when it cannot be read.
 *
 * `starttime` counts from boot, so the epoch conversion needs `btime` from
 * `/proc/stat`. Read once: it cannot change while the machine is up. A host
 * that answers nothing keeps 0, which the sampler reads as "start unknown"
 * rather than as a process that began at the epoch.
 */
let bootMsCache: number | null = null;
function bootMs(): number {
  if (bootMsCache !== null) return bootMsCache;
  bootMsCache = 0;
  const raw = readFile('/proc/stat');
  if (raw) {
    const match = /^btime\s+(\d+)/m.exec(raw);
    if (match) bootMsCache = Number(match[1]) * 1000;
  }
  return bootMsCache;
}

/** The process's working directory, or null. */
function cwdOf(pid: number): string | null {
  try {
    const path = fs.readlinkSync(`/proc/${pid}/cwd`);
    return path.startsWith('/') ? path : null;
  } catch {
    // Exited mid-sweep, or not ours to read.
    return null;
  }
}

/** `{ rss, threads }` from one `status` read. Both default to 0 when absent. */
function statusOf(pid: number): { rss: number; threads: number } {
  const raw = readFile(`/proc/${pid}/status`);
  if (raw === null) return { rss: 0, threads: 0 };
  const rssMatch = /VmRSS:\s+(\d+) kB/.exec(raw);
  const threadsMatch = /Threads:\s+(\d+)/.exec(raw);
  return {
    rss: rssMatch ? Number(rssMatch[1]) * 1024 : 0,
    threads: threadsMatch ? Number(threadsMatch[1]) : 0,
  };
}

/** argv from the NUL-separated `cmdline`, or null for a kernel thread. */
function argvOf(pid: number): string[] | null {
  const raw = readFile(`/proc/${pid}/cmdline`);
  if (raw === null) return null;
  const parts = raw.split('\0').filter((part) => part.length > 0);
  if (parts.length > 0) return parts;
  // A kernel thread has no argv; `comm` is all the identity there is.
  const comm = readFile(`/proc/${pid}/comm`);
  return comm ? [comm.trim()] : null;
}

export const linuxProbe: ProcProbe = {
  name: 'linux',
  supported: true,
  list() {
    let entries: string[];
    try {
      entries = fs.readdirSync('/proc');
    } catch {
      return [];
    }
    const out: ProcessInfo[] = [];
    for (const entry of entries) {
      // `/proc` holds more than pids: `self`, `net`, `sys`, `irq`, … A digit
      // test is the whole filter, and it is cheaper than a `stat` per entry.
      if (!/^\d+$/.test(entry)) continue;
      const pid = Number(entry);
      const stat = statOf(pid);
      if (!stat) continue;
      const status = statusOf(pid);
      out.push({
        pid,
        ppid: stat.ppid,
        rss: status.rss,
        cpuNs: stat.cpuNs,
        threads: status.threads,
        argv: argvOf(pid),
        cwd: cwdOf(pid),
        startedAt: stat.startedAt,
      });
    }
    return out;
  },
};
