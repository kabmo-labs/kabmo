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
 * The same work with an explicit `Bun.gc(true)` in the middle measured
 * 319 MB → 69 MB in a standalone probe, so the memory is garbage the collector
 * had simply not been asked to reclaim — a young-generation collection returns
 * the JS objects but leaves the arena, and nothing in this process allocates
 * enough to force a full one.
 *
 * Two rules keep the sweep honest:
 *
 * 1. **It is a CEILING, not a schedule.** A full collection is stop-the-world,
 *    so a sweep that ran on a timer regardless of pressure would add pauses to
 *    a healthy process for nothing. Nothing happens below `ceilingBytes`.
 * 2. **It is observable.** `snapshot()` is what `/api/health` reports, so the
 *    condition the sweep reacts to is visible from `kabmo status` rather than
 *    only from Activity Monitor.
 */

/** Bytes in a megabyte, for the MB-shaped numbers this module reports. */
const BYTES_PER_MB = 1024 * 1024;

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

/** Default ceiling: above this, a sweep is worth a pause. */
const DEFAULT_CEILING_MB = 1024;

/** How often pressure is checked. A minute is far below the rate at which the
 *  measured growth matters, and cheap when nothing is over the ceiling. */
const DEFAULT_INTERVAL_MS = 60_000;

export interface MemorySnapshot {
  /** Resident set size in MB — what a process monitor shows. */
  rssMB: number;
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

/** The process's memory, in MB. Reads `process.memoryUsage()`, never throws. */
export function snapshot(): MemorySnapshot {
  const usage = process.memoryUsage();
  return {
    rssMB: residentMB(),
    heapUsedMB: Math.round(usage.heapUsed / BYTES_PER_MB),
    heapTotalMB: Math.round(usage.heapTotal / BYTES_PER_MB),
  };
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
  const before = snapshot();
  if (!force && before.rssMB * BYTES_PER_MB < ceilingBytes()) {
    return { swept: false, before, after: before };
  }
  // A full collection: the point is to release the arena, and the young
  // generation alone is what failed to do that.
  Bun.gc(true);
  return { swept: true, before, after: snapshot() };
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
        console.log(`[kabmo] memory: swept ${result.before.rssMB} MB → ${result.after.rssMB} MB`);
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
