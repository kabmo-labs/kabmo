/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The sweep's contract: it reacts to a CEILING, and it can be observed.
 *
 * The measurements that motivate it are in `memory.ts`; what this file pins is
 * the part a future change could silently break — that a healthy process pays
 * nothing, that an over-ceiling one actually collects, and that the ceiling is
 * configurable without a rebuild.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import {
  footprintMBFromOutput,
  footprintMBFromSmapsRollup,
  maintainMemory,
  snapshot,
  stopMemoryMaintenance,
} from '@/server/lib/lifecycle/memory';

const originalCeiling = Bun.env.KABMO_MEMORY_CEILING_MB;

afterEach(() => {
  if (originalCeiling === undefined) delete Bun.env.KABMO_MEMORY_CEILING_MB;
  else Bun.env.KABMO_MEMORY_CEILING_MB = originalCeiling;
  stopMemoryMaintenance();
});

describe('snapshot', () => {
  test('reports the process in MB', () => {
    // Not `heapUsed <= heapTotal`: Bun reports a committed main heap that can be
    // SMALLER than the live set once large objects live outside it (observed
    // 65 MB used against 37 MB total). The invariant that does hold is that the
    // resident set contains the heap.
    const snap = snapshot();
    expect(snap.rssMB).toBeGreaterThan(0);
    expect(snap.heapUsedMB).toBeGreaterThan(0);
    expect(snap.rssMB).toBeGreaterThanOrEqual(snap.heapUsedMB);
  });

  test('the resident set is the OPERATING SYSTEM number', () => {
    // The ceiling must react to the number a process monitor shows. Measured on
    // Bun 1.4.4 / macOS 27: a live server holding 902 MB of real RSS reported
    // 299 MB through `process.memoryUsage().rss`, so a ceiling built on that
    // would never fire and the sweep would never run.
    //
    // The number is compared against the SAME source the module reads on this
    // platform — `ps` on POSIX, `process.memoryUsage().rss` on Windows, where
    // there is no `ps` in the shell PATH (measured: the spawn answers nothing
    // there, so the module's win32 branch IS the runtime's own number) — so
    // this pins the SOURCE rather than asserting a relationship between two
    // estimates.
    if (process.platform === 'win32') {
      const jsMB = Math.round(process.memoryUsage().rss / (1024 * 1024));
      expect(Math.abs(snapshot().rssMB - jsMB)).toBeLessThanOrEqual(1);
      return;
    }
    const psKb = Number(
      Bun.spawnSync(['ps', '-o', 'rss=', '-p', String(process.pid)]).stdout.toString().trim(),
    );
    expect(Math.abs(snapshot().rssMB - Math.round(psKb / 1024))).toBeLessThanOrEqual(2);
  });

  test('reports a physical footprint, because RSS is not the memory in use', () => {
    // On macOS a Bun process that has read and dropped a transcript keeps
    // freed pages resident: measured on a live server, RSS 752 MB against a
    // 70.6 MB physical footprint and a 24 MB JS heap. The sweep reacts to the
    // footprint, so it has to be there.
    const snap = snapshot();
    expect(snap.footprintMB).not.toBeNull();
    expect(snap.footprintMB ?? 0).toBeGreaterThan(0);
    // A footprint larger than the resident set would mean the parser read the
    // wrong field; compressed pages can push it close, never past it by much.
    expect(snap.footprintMB ?? 0).toBeLessThanOrEqual(snap.rssMB * 1.25 + 16);
  });
});

describe('footprint parsing', () => {
  test('reads the macOS `footprint -p` headline', () => {
    expect(footprintMBFromOutput('bun [98166]: 64-bit    Footprint: 122 MB (16384 bytes per page)')).toBe(122);
  });

  test('honours the unit the tool prints', () => {
    expect(footprintMBFromOutput('  Footprint: 512 KB (4096 bytes per page)')).toBe(1);
    expect(footprintMBFromOutput('  Footprint: 1.5 GB (16384 bytes per page)')).toBe(1536);
  });

  test('an unreadable report is null rather than a guess', () => {
    expect(footprintMBFromOutput('')).toBeNull();
    expect(footprintMBFromOutput('some other report')).toBeNull();
  });

  test('reads Pss from Linux smaps_rollup', () => {
    expect(footprintMBFromSmapsRollup('Rss: 40960 kB\nPss: 12345 kB\nPss_Anon: 1 kB\n')).toBe(12);
    expect(footprintMBFromSmapsRollup('Rss: 40960 kB\n')).toBeNull();
  });
});

describe('maintainMemory', () => {
  test('does nothing below the ceiling — a healthy process pays no pause', () => {
    // A ceiling no process can be under, so the sweep must stand down.
    Bun.env.KABMO_MEMORY_CEILING_MB = '1000000';
    const result = maintainMemory();
    expect(result.swept).toBe(false);
    expect(result.after).toEqual(result.before);
  });

  test('collects when the process is over its ceiling', () => {
    // 1 MB is below any real RSS, so the ceiling is genuinely exceeded. What
    // this pins is that the branch RUNS and reports both sides of the sweep;
    // the amount reclaimed is the runtime's business (a sibling test in this
    // file is allocating while it runs, so a before/after comparison here would
    // measure the test harness, not the collector).
    Bun.env.KABMO_MEMORY_CEILING_MB = '1';
    const result = maintainMemory();
    expect(result.swept).toBe(true);
    expect(result.before.rssMB).toBeGreaterThan(0);
    expect(result.after.rssMB).toBeGreaterThan(0);
  });

  test('a forced sweep runs even under the ceiling', () => {
    Bun.env.KABMO_MEMORY_CEILING_MB = '1000000';
    expect(maintainMemory(true).swept).toBe(true);
  });
});
