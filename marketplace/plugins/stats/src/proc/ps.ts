/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The `ps` fallback, for a platform with no native probe.
 *
 * One spawn answers the whole table — `ps -axo pid=,ppid=,rss=,time=,comm=` —
 * and the CPU figure is derived by DIFFERENCE between sweeps, because `ps` has
 * no cumulative field: `%cpu` is itself a lifetime average computed by `ps`
 * from the process's start time, which is not a rate the sampler can subtract.
 * The `time=` column IS cumulative (`[[dd-]hh:]mm:ss`), so it is parsed back
 * into nanoseconds and the sampler's ordinary delta math applies unchanged.
 *
 * `comm=` rather than `args=` for argv: `args` on a foreign process is not
 * always readable, and the sampler's classifier only needs the executable to
 * name an unattributable row. A full argv is a nicety the native probes give
 * and this one does not have to.
 *
 * Cost, measured on 547 processes: 10 ms per sweep against 0.75 ms for
 * `libproc`. That is the price of being the fallback, and it is why this is
 * not the macOS path.
 */

import { spawnSync } from 'bun';

import type { ProcProbe, ProcessInfo } from './types';

/** `[[dd-]hh:]mm:ss` or `mm:ss.ss`, as `ps` prints `time=`. */
function parseCpuTime(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  let days = 0;
  let rest = text;
  const dash = rest.indexOf('-');
  if (dash !== -1) {
    days = Number(rest.slice(0, dash));
    rest = rest.slice(dash + 1);
  }
  const parts = rest.split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  const seconds = Number(parts.pop());
  const minutes = Number(parts.pop());
  const hours = parts.length > 0 ? Number(parts[0]) : 0;
  if (!Number.isFinite(days) || !Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return null;
  }
  return ((days * 24 + hours) * 3600 + minutes * 60 + seconds) * 1e9;
}

export const psProbe: ProcProbe = {
  name: 'ps',
  supported: true,
  list() {
    const out: ProcessInfo[] = [];
    try {
      const snapshot = spawnSync({
        cmd: ['ps', '-axo', 'pid=,ppid=,rss=,time=,comm='],
        stdout: 'pipe',
        stderr: 'ignore',
      });
      if (!snapshot.success) return out;
      for (const line of snapshot.stdout.toString().split('\n')) {
        // pid, ppid, rss(KB), time, then the rest of the line as the command —
        // `comm` runs to end of line, so the command column must not be split.
        const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
        if (!match) continue;
        const cpuNs = parseCpuTime(match[4]);
        out.push({
          pid: Number(match[1]),
          ppid: Number(match[2]),
          // `ps rss` is kB on every platform this runs on.
          rss: Number(match[3]) * 1024,
          cpuNs: cpuNs ?? 0,
          threads: 0,
          argv: match[5].trim() ? [match[5].trim()] : null,
        });
      }
    } catch {
      // No `ps` on PATH: the panel reports an empty table rather than failing.
    }
    return out;
  },
};
