/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The formatters, and the real probe against this machine.
 *
 * Two kinds of assertion, and the second is the one that matters: a formatter
 * that prints `0.0%` for "no measurement" is a lie a reader would never catch,
 * and a probe whose struct offsets drift is a set of plausible numbers that are
 * all wrong. So the probe is exercised against the LIVE process table and its
 * answers are cross-checked against `ps`.
 */

import { describe, expect, test } from 'bun:test';

import { formatAge, formatBytes, formatPercent } from './format';
import { procProbe } from './proc';
import { readDaemonRegistry } from './daemons';

describe('formatBytes', () => {
  test('scales and keeps a decimal past a kilobyte', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(1.5 * 1024 ** 2)).toBe('1.5 MB');
    expect(formatBytes(3.7 * 1024 ** 3)).toBe('3.7 GB');
  });

  test('a small-but-real figure is not rounded away to zero', () => {
    // The failure this pins: a sub-megabyte figure printing as `0 MB`, which
    // reads as "this process uses nothing". It lands in KB instead.
    expect(formatBytes(0.4 * 1024 ** 2)).toBe('410 KB');
    expect(formatBytes(0.4 * 1024 ** 2)).not.toBe('0 MB');
  });
});

describe('formatPercent', () => {
  test('null is a dash, never a zero', () => {
    // `cpuPercent` is null on the first sample and for a just-appeared process.
    // Printing `0.0%` for either claims the process is idle.
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(0)).toBe('0.0%');
    expect(formatPercent(12.34)).toBe('12.3%');
    expect(formatPercent(140)).toBe('140%');
  });
});

describe('formatAge', () => {
  test('an unsampled stamp says never, not a negative age', () => {
    expect(formatAge(0, Date.now())).toBe('never');
    expect(formatAge(1000, 1100)).toBe('just now');
    expect(formatAge(1000, 1000 + 30_000)).toBe('30s ago');
    expect(formatAge(1000, 1000 + 120_000)).toBe('2m ago');
  });
});

describe('procProbe against this machine', () => {
  test('the probe is supported here and finds this process', () => {
    expect(procProbe.supported).toBe(true);
    const rows = procProbe.list();
    expect(rows.length).toBeGreaterThan(1);
    const self = rows.find((row) => row.pid === process.pid);
    expect(self).toBeDefined();
    // The probe must report SOMETHING for its own process, and the figure has
    // to be the same order of magnitude Bun reports — a struct-offset drift
    // would produce a plausible-looking number, which is why this is checked
    // against a second source rather than against a constant.
    expect(self?.rss).toBeGreaterThan(1024 * 1024);
    const bunRss = process.memoryUsage().rss;
    expect(self!.rss).toBeGreaterThan(bunRss * 0.5);
    expect(self!.rss).toBeLessThan(bunRss * 2);
    expect(self?.argv?.[0]).toContain('bun');
  });

  test('rss agrees with ps for this process', () => {
    const ps = Bun.spawnSync(['ps', '-o', 'rss=', '-p', String(process.pid)]);
    const psBytes = Number(ps.stdout.toString().trim()) * 1024;
    const self = procProbe.list().find((row) => row.pid === process.pid);
    expect(self).toBeDefined();
    // `ps rss` is the resident size in kB; a 25% band absorbs the moment
    // between the two reads and the different accounting each uses.
    const ratio = self!.rss / psBytes;
    expect(ratio).toBeGreaterThan(0.75);
    expect(ratio).toBeLessThan(1.25);
  });

  test('cpu time advances for a busy process', async () => {
    // The one genuine wall-clock wait in this suite, and it cannot be faked:
    // the assertion is that the KERNEL's cumulative counter for a real process
    // moves, which no fake timer can produce. 500 ms is far longer than the
    // resolution of the counter on any platform this runs on.
    const busy = Bun.spawn(['bash', '-c', 'while :; do :; done']);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const first = procProbe.list().find((row) => row.pid === busy.pid);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const second = procProbe.list().find((row) => row.pid === busy.pid);
    busy.kill();
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    // A spin loop must accrue CPU. The unit is the probe's own (nanoseconds by
    // contract), so the check is that it MOVED, in a plausible order.
    expect(second!.cpuNs).toBeGreaterThan(first!.cpuNs);
    expect(second!.cpuNs - first!.cpuNs).toBeGreaterThan(50e6);
  });

  test('the daemon registry reads without a subprocess', () => {
    // Not asserting a daemon exists — that is the machine's state, not this
    // code's. What is pinned is that the read is a plain, non-throwing read of
    // disk, so an absent registry is an empty list rather than a failure.
    const daemons = readDaemonRegistry();
    expect(Array.isArray(daemons)).toBe(true);
    for (const daemon of daemons) {
      expect(typeof daemon.name).toBe('string');
      expect(Number.isInteger(daemon.pid)).toBe(true);
    }
  });
});
