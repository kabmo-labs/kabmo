/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The machine's own numbers: total and AVAILABLE memory, cores, load.
 *
 * `os.freemem()` is the wrong answer on macOS, and it was the wrong answer for
 * this panel: it reports `Pages free` alone. Measured on this host while the
 * system had 5.60 GB available:
 *
 * ```
 * os.freemem()                       1.05 GB
 * Pages free                         1.04 GB
 * Pages inactive                     4.53 GB
 * Pages speculative                  0.03 GB
 * free + inactive + speculative      5.60 GB
 * ```
 *
 * Inactive and speculative pages are memory the kernel hands out again without
 * touching swap, so a reader comparing the stack's usage against the 1 GB
 * denominator concludes the machine is nearly full when it is not. "Available"
 * here is `free + inactive + speculative`; `Pages purgeable` is deliberately
 * NOT added, because it is already counted in the inactive total.
 *
 * Linux needs no new source: `/proc/meminfo`'s `MemAvailable` is the kernel's
 * own estimate of what a new allocation can get without swapping, which is a
 * better figure than `MemFree` for exactly the same reason.
 *
 * Windows keeps `os.freemem()`: it reports the same "Available" figure the
 * task manager does.
 *
 * `vm_stat` costs 8.8 ms measured (a spawn), while a sample lands every
 * second, so the reading is cached for `FREE_MEMORY_TTL_MS`. Free memory moves
 * on the scale of seconds, not ticks; the panel's own totals are re-read every
 * sample regardless.
 */

import { readFileSync } from 'node:fs';
import os from 'node:os';

import type { MachineContext } from './snapshot';

/** How long a free-memory reading is reused. */
export const FREE_MEMORY_TTL_MS = 5_000;

/**
 * `free + inactive + speculative`, from `vm_stat`.
 *
 * The page size is taken from the report's own header (`page size of 16384
 * bytes` on Apple silicon, 4096 on Intel) rather than assumed: a page count
 * read against the wrong size is silently off by 4x.
 */
export function freeMemBytesFromVmStat(output: string): number | null {
  const pageSize = Number(/page size of (\d+) bytes/.exec(output)?.[1] ?? 0);
  if (!Number.isFinite(pageSize) || pageSize <= 0) return null;
  const pages = (label: string): number => {
    const match = new RegExp(`^${label}:\\s+(\\d+)\\.?$`, 'm').exec(output);
    return match ? Number(match[1]) : 0;
  };
  const free = pages('Pages free');
  const inactive = pages('Pages inactive');
  const speculative = pages('Pages speculative');
  if (free === 0 && inactive === 0 && speculative === 0) return null;
  return (free + inactive + speculative) * pageSize;
}

/** `MemAvailable: 12345 kB` from `/proc/meminfo`, in bytes. */
export function freeMemBytesFromMeminfo(text: string): number | null {
  const match = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(text);
  return match ? Number(match[1]) * 1024 : null;
}

let cached: { at: number; bytes: number } | null = null;

/** Available memory on this host, in bytes. Cached; never throws. */
export function freeMemBytes(now = Date.now()): number {
  if (cached && now - cached.at < FREE_MEMORY_TTL_MS) return cached.bytes;
  let bytes: number | null = null;
  if (process.platform === 'darwin') {
    try {
      bytes = freeMemBytesFromVmStat(Bun.spawnSync(['vm_stat']).stdout.toString());
    } catch {
      // No `vm_stat` on this host: the runtime's own number is the fallback.
      bytes = null;
    }
  } else if (process.platform === 'linux') {
    try {
      bytes = freeMemBytesFromMeminfo(readFileSync('/proc/meminfo', 'utf8'));
    } catch {
      bytes = null;
    }
  }
  const answer = bytes ?? Number(os.freemem());
  cached = { at: now, bytes: answer };
  return answer;
}

/** Everything the panel reports about the machine itself. */
export function readMachine(): MachineContext {
  const cpuCount = os.cpus().length;
  const load = os.loadavg()[0];
  return {
    totalMemBytes: Number(os.totalmem()),
    freeMemBytes: freeMemBytes(),
    cpuCount,
    loadPerCore: cpuCount > 0 ? load / cpuCount : load,
  };
}

/** Drop the cached reading. For tests; the panel never needs it. */
export function clearMachineCache(): void {
  cached = null;
}