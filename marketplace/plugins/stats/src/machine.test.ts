/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The machine reading — `os.freemem()` is not "memory available" on macOS.
 *
 * Measured on this host while 5.60 GB was actually available: `os.freemem()`
 * and `Pages free` both read 1.05 GB, because the runtime counts only free
 * pages and ignores the 4.53 GB of inactive ones the kernel hands out again
 * without swapping. A panel that shows the stack's usage against 1 GB while
 * 5.6 GB is available tells the reader the machine is full when it is not.
 *
 * The parsers are pinned here; the spawn (`vm_stat`, 8.8 ms) is not exercised,
 * because a test that spawns a platform tool is a test that skips on the
 * platform CI runs it on.
 */

import { describe, expect, test } from 'bun:test';
import os from 'node:os';

import { freeMemBytes, freeMemBytesFromMeminfo, freeMemBytesFromVmStat } from './machine';

const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                   68590.
Pages active:                                286755.
Pages inactive:                              296680.
Pages speculative:                             2081.
Pages throttled:                                  0.
Pages wired down:                             63387.
Pages purgeable:                               7201.
`;

describe('freeMemBytesFromVmStat', () => {
  test('counts free + inactive + speculative, at the reported page size', () => {
    expect(freeMemBytesFromVmStat(VM_STAT)).toBe((68590 + 296680 + 2081) * 16384);
  });

  test('reads the page size from the header, not a constant', () => {
    // Intel Macs report 4096; assuming Apple silicon's 16384 would be 4x off.
    const intel = VM_STAT.replace('page size of 16384 bytes', 'page size of 4096 bytes');
    expect(freeMemBytesFromVmStat(intel)).toBe((68590 + 296680 + 2081) * 4096);
  });

  test('a report with no page size is unusable rather than zero', () => {
    expect(freeMemBytesFromVmStat('Mach Virtual Memory Statistics:')).toBeNull();
  });

  test('a report with counters but no usable page is unusable too', () => {
    expect(freeMemBytesFromVmStat('page size of 16384 bytes\nPages active: 10.')).toBeNull();
  });
});

describe('freeMemBytesFromMeminfo', () => {
  test('reads MemAvailable, not MemFree', () => {
    const meminfo = `MemTotal:       16000000 kB
MemFree:         1000000 kB
MemAvailable:    8123456 kB
`;
    expect(freeMemBytesFromMeminfo(meminfo)).toBe(8_123_456 * 1024);
  });

  test('a kernel without MemAvailable answers null, never MemFree', () => {
    // Pre-3.14 kernels have no MemAvailable. Falling back to MemFree would
    // understate the same way `os.freemem()` does on macOS, under another name.
    expect(freeMemBytesFromMeminfo('MemFree: 1000000 kB\n')).toBeNull();
  });
});

describe('freeMemBytes', () => {
  test('answers a plausible figure for this host', () => {
    const bytes = freeMemBytes(Date.now() + 60_000);
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThanOrEqual(Number(os.totalmem()));
  });
});