/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The memory sweep: when the server asks the runtime to collect, and what it
 * reports about itself.
 *
 * Why this exists at all: reading a session is allocation-heavy and the Bun
 * heap does not shrink back on its own. Measured on this repo's own store (an
 * 11 MB session, 1,024 messages), against a real server:
 *
 * | scenario | RSS |
 * |---|---|
 * | boot | 76 MB |
 * | 10 sequential `GET /api/chat/:id` | 487 MB |
 * | 20 concurrent `GET /api/chat/:id` | 1.69 GB |
 * | 10 s idle afterwards | 1.13 GB |
 *
 * Two rules keep the sweep honest:
 *
 * 1. **It is a CEILING, not a schedule.** A full collection is stop-the-world,
 *    so a sweep that ran on a timer regardless of pressure would add pauses to
 *    a healthy process for nothing. Nothing happens below `ceilingBytes`.
 * 2. **It is observable.** `snapshot()` is what `/api/health` reports, so the
 *    condition the sweep reacts to is visible from `kabmo status` rather than
 *    only from Activity Monitor.
 *
 * ## Which number is "memory"
 *
 * RSS is NOT it. On macOS a Bun process that has read and dropped a large
 * transcript keeps the freed pages resident: measured on a live server, RSS
 * 752 MB while the operating system charged the process a 70.6 MB physical
 * footprint (`vmmap -summary`), with a 24 MB JS heap — and `Bun.gc(true)`
 * changed nothing (`swept 1049 MB → 1050 MB`, every minute, for hours). The
 * same process's RSS fell to 134 MB on its own once the OS reclaimed the
 * clean pages.
 *
 * So the ceiling is applied to the OS's PHYSICAL FOOTPRINT where the host can
 * answer, and `rssMB` is reported beside it as a diagnostic because that is
 * the number `ps`-style tools show. `footprint -p <pid>` prints it on macOS
 * (78 ms, and its headline matched `vmmap`'s "Physical footprint" exactly —
 * 122 MB against 121.6 MB); Linux answers from `/proc/self/smaps_rollup`
 * (`Pss`, which discounts shared pages) with `VmRSS` as the fallback; Windows
 * uses the runtime's own number, which is accurate there.
 *
 * A reading is cached for `FOOTPRINT_TTL_MS`: the probe costs a spawn, and
 * `/api/health` is polled far more often than the number can move. The sweep
 * always refreshes both sides, because it is reporting the effect of a
 * collection it just ran.
 */

import { readFileSync } from 'node:fs';

/** Bytes in a megabyte, for the MB-shaped numbers this module reports. */
const BYTES_PER_MB = 1024 * 1024;

/** How long an operating-system footprint reading is reused. */
const FOOTPRINT_TTL_MS = 30_000;

/**
 * The process's resident set, in MB, from the OPERATING SYSTEM.
 *
 * Deliberately not `process.memoryUsage().rss`: on Bun 1.4.4 / macOS 27 it
 * under-reports by a factor of three once the allocator has fragmented. Measured
 * on a live server holding 902 MB of real RSS, `memoryUsage().rss` said 299 MB —
 * so a ceiling built on it would never fire, and the sweep this module exists for
 * would never run. `ps` is the number a process monitor shows, and one spawn per
 * interval is nothing beside the collection it decides.
 *
 * `ps` rather than `/proc/self/statm`: one code path for the POSIX platforms
 * the shells ship on, and the sweep runs once a minute.
 *
 * Windows is the exception: there is no `ps` in the shell PATH, so the spawn
 * answers nothing and falls back anyway (measured on a Windows runner, where
 * the answer is empty). The branch reads the runtime's own number directly —
 * accurate there, the under-report above being macOS-specific — and saves a
 * useless spawn on every interval.
 */
function residentMB(): number {
  if (process.platform === 'win32') return Math.round(process.memoryUsage().rss / BYTES_PER_MB);
  try {
    const out = Bun.spawnSync(['ps', '-o', 'rss=', '-p', String(process.pid)]);
    const kb = Number(out.stdout.toString().trim());
    if (Number.isFinite(kb) && kb > 0) return Math.round(kb / 1024);
  } catch {
    // A platform that cannot answer falls back to the runtime's own number,
    // which is an under-estimate rather than a failure.
  }
  return Math.round(process.memoryUsage().rss / BYTES_PER_MB);
}

/**
 * The footprint line from `footprint -p <pid>`:
 * `bun [123]: 64-bit    Footprint: 122 MB (16384 bytes per page)`.
 *
 * Exported as a pure parser so the shape is pinned without spawning anything.
 */
export function footprintMBFromOutput(output: string): number | null {
  const match = /Footprint:\s+([\d.]+)\s+(B|KB|MB|GB)\b/i.exec(output);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = match[2].toUpperCase();
  const mb = unit === 'GB' ? value * 1024
    : unit === 'KB' ? value / 1024
    : unit === 'B' ? value / BYTES_PER_MB
    : value;
  return Math.round(mb);
}

/** `Pss:` from `/proc/self/smaps_rollup` — the Linux analogue of footprint. */
export function footprintMBFromSmapsRollup(text: string): number | null {
  const match = /^Pss:\s+(\d+)\s+kB$/m.exec(text);
  if (!match) return null;
  return Math.round(Number(match[1]) / 1024);
}

/** The OS's own charge for this process, in MB, or null where it cannot answer. */
function readFootprintMB(): number | null {
  if (process.platform === 'win32') {
    return Math.round(process.memoryUsage().rss / BYTES_PER_MB);
  }
  if (process.platform === 'linux') {
    try {
      const pss = footprintMBFromSmapsRollup(readFileSync('/proc/self/smaps_rollup', 'utf8'));
      if (pss !== null) return pss;
    } catch {
      // smaps_rollup is unreadable on a hardened kernel; VmRSS below.
    }
    try {
      const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(readFileSync('/proc/self/status', 'utf8'));
      if (match) return Math.round(Number(match[1]) / 1024);
    } catch {
      return null;
    }
    return null;
  }
  try {
    const out = Bun.spawnSync(['footprint', '-p', String(process.pid)]);
    return footprintMBFromOutput(out.stdout.toString());
  } catch {
    // No `footprint` on this host (an older macOS, another POSIX): the sweep
    // falls back to RSS.
    return null;
  }
}

interface FootprintCache {
  at: number;
  mb: number | null;
}

let footprintCache: FootprintCache | null = null;

/** The cached OS charge, refreshed when `refresh` or when the reading is stale. */
function footprintMB(refresh: boolean): number | null {
  if (!refresh && footprintCache && Date.now() - footprintCache.at < FOOTPRINT_TTL_MS) {
    return footprintCache.mb;
  }
  const mb = readFootprintMB();
  footprintCache = { at: Date.now(), mb };
  return mb;
}

/** Default ceiling: above this, a sweep is worth a pause. */
const DEFAULT_CEILING_MB = 1024;

/** How often pressure is checked. A minute is far below the rate at which the
 *  measured growth matters, and cheap when nothing is over the ceiling. */
const DEFAULT_INTERVAL_MS = 60_000;

export interface MemorySnapshot {
  /** Resident set size in MB — what a `ps`-style monitor shows. On macOS it
   *  counts freed pages Bun has not returned, so it can exceed the footprint
   *  many times over. Reported for diagnosis; never the sweep's input. */
  rssMB: number;
  /** What the operating system actually charges this process, in MB. Null when
   *  the host cannot answer. This is the number the sweep reacts to. */
  footprintMB: number | null;
  /** Live JS objects in MB. */
  heapUsedMB: number;
  /** Reserved JS heap in MB (what the collector has not returned). */
  heapTotalMB: number;
}

export interface SweepResult {
  /** True when a full collection actually ran. */
  swept: boolean;
  before: MemorySnapshot;
  after: MemorySnapshot;
}

/** A stop handle for the periodic sweep. */
export interface MemoryMaintenance {
  stop: () => void;
}

function takeSnapshot(refreshFootprint: boolean): MemorySnapshot {
  const usage = process.memoryUsage();
  return {
    rssMB: residentMB(),
    footprintMB: footprintMB(refreshFootprint),
    heapUsedMB: Math.round(usage.heapUsed / BYTES_PER_MB),
    heapTotalMB: Math.round(usage.heapTotal / BYTES_PER_MB),
  };
}

/** The process's memory, in MB. Cached footprint, never throws. */
export function snapshot(): MemorySnapshot {
  return takeSnapshot(false);
}

/** The pressure the ceiling is applied to: the OS's charge when it is known. */
function pressureMB(snap: MemorySnapshot): number {
  return snap.footprintMB ?? snap.rssMB;
}

/** The ceiling in bytes, from `KABMO_MEMORY_CEILING_MB` when set. */
function ceilingBytes(): number {
  const raw = Number(Bun.env.KABMO_MEMORY_CEILING_MB);
  const mb = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CEILING_MB;
  return mb * BYTES_PER_MB;
}

/**
 * Collect if the process is over its ceiling, else do nothing.
 *
 * `force` is for a caller that has just dropped something large and knows the
 * arena is holding it — the maintenance interval never passes it.
 */
export function maintainMemory(force = false): SweepResult {
  // Both sides refresh the OS reading: this function exists to report what a
  // collection did, and a cached number would report the state before it.
  const before = takeSnapshot(true);
  if (!force && pressureMB(before) * BYTES_PER_MB < ceilingBytes()) {
    return { swept: false, before, after: before };
  }
  // A full collection: the point is to release the arena, and the young
  // generation alone is what failed to do that.
  Bun.gc(true);
  return { swept: true, before, after: takeSnapshot(true) };
}

/** Where the interval lives, so a `bun --hot` reload does not install a second. */
interface MemorySweepHost {
  __kabmoMemorySweep?: ReturnType<typeof setInterval>;
}

/** Stop the periodic sweep, if one is installed. */
export function stopMemoryMaintenance(): void {
  const host = globalThis as typeof globalThis & MemorySweepHost;
  if (!host.__kabmoMemorySweep) return;
  clearInterval(host.__kabmoMemorySweep);
  host.__kabmoMemorySweep = undefined;
}

/**
 * Install the periodic sweep. Idempotent across `bun --hot` reloads: the timer
 * lives on `globalThis`, because a reload re-evaluates this module while the
 * previous interval keeps firing.
 */
export function installMemoryMaintenance(): MemoryMaintenance {
  const host = globalThis as typeof globalThis & MemorySweepHost;
  if (host.__kabmoMemorySweep) return { stop: stopMemoryMaintenance };

  const raw = Number(Bun.env.KABMO_MEMORY_SWEEP_MS);
  const intervalMs = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_INTERVAL_MS;
  const timer = setInterval(() => {
    try {
      const result = maintainMemory();
      if (result.swept) {
        // Footprint first: it is the number the decision used, and the one a
        // reader should trust. RSS rides along because a monitor shows it.
        console.log(
          `[kabmo] memory: swept ${pressureMB(result.before)} MB → ${pressureMB(result.after)} MB`
          + ` (rss ${result.after.rssMB} MB)`,
        );
      }
    } catch (error) {
      // A sweep is maintenance, never a reason to take the server down.
      console.error(`[kabmo] memory: sweep failed — ${error instanceof Error ? error.message : String(error)}`);
    }
  }, intervalMs);
  // The interval must not keep the process alive on its own.
  timer.unref?.();
  host.__kabmoMemorySweep = timer;
  return { stop: stopMemoryMaintenance };
}