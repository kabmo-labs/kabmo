/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `ps` fallback, for a platform with no native probe.
 *
 * One spawn answers the whole table — `ps -axo pid=,ppid=,rss=,time=,etime=,comm=`
 * — and the CPU figure is derived by DIFFERENCE between sweeps, because `ps` has
 * no cumulative field: `%cpu` is itself a lifetime average computed by `ps`
 * from the process's start time, which is not a rate the sampler can subtract.
 * The `time=` column IS cumulative (`[[dd-]hh:]mm:ss`), so it is parsed back
 * into nanoseconds and the sampler's ordinary delta math applies unchanged.
 *
 * `etime=` is read for the same reason the native probes read a start time: age
 * is what makes a stuck process visible. It is a DURATION, so the epoch value
 * the sampler wants is `now - etime`, computed at the read.
 *
 * `comm=` rather than `args=` for argv: `args` on a foreign process is not
 * always readable, and the sampler's classifier only needs the executable to
 * name an unattributable row. A full argv is a nicety the native probes give
 * and this one does not have to — and for the same reason there is no `cwd`:
 * no column carries one, so the field is honestly null rather than guessed.
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

/**
 * `etime=` as elapsed milliseconds, or null.
 *
 * The same grammar as `time=` minus the fractional seconds: `[[dd-]hh:]mm:ss`.
 * Parsed from the RIGHT — a two-field reading is `MM:SS`, not `HH:MM`, which is
 * the mistake that reported a 54-minute process as 54 hours.
 */
function parseElapsed(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  let days = 0;
  let rest = text;
  const dash = rest.indexOf('-');
  if (dash !== -1) {
    days = Number(rest.slice(0, dash));
    rest = rest.slice(dash + 1);
  }
  const parts = rest.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;
  const seconds = parts.length > 0 ? parts[parts.length - 1] : 0;
  const minutes = parts.length > 1 ? parts[parts.length - 2] : 0;
  const hours = parts.length > 2 ? parts[parts.length - 3] : 0;
  return ((days * 24 + hours) * 3600 + minutes * 60 + seconds) * 1000;
}

export const psProbe: ProcProbe = {
  name: 'ps',
  supported: true,
  list() {
    const out: ProcessInfo[] = [];
    try {
      const snapshot = spawnSync({
        cmd: ['ps', '-axo', 'pid=,ppid=,rss=,time=,etime=,comm='],
        stdout: 'pipe',
        stderr: 'ignore',
      });
      if (!snapshot.success) return out;
      const now = Date.now();
      for (const line of snapshot.stdout.toString().split('\n')) {
        // pid, ppid, rss(KB), time, etime, then the rest of the line as the
        // command — `comm` runs to end of line, so the command column must not
        // be split.
        const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.*)$/.exec(line);
        if (!match) continue;
        const cpuNs = parseCpuTime(match[4]);
        const elapsed = parseElapsed(match[5]);
        out.push({
          pid: Number(match[1]),
          ppid: Number(match[2]),
          // `ps rss` is kB on every platform this runs on.
          rss: Number(match[3]) * 1024,
          cpuNs: cpuNs ?? 0,
          threads: 0,
          argv: match[6].trim() ? [match[6].trim()] : null,
          // `comm` is the only column read, and it carries no directory.
          cwd: null,
          startedAt: elapsed === null ? 0 : now - elapsed,
        });
      }
    } catch {
      // No `ps` on PATH: the panel reports an empty table rather than failing.
    }
    return out;
  },
};
