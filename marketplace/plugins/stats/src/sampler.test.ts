/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The sampler, against synthetic process tables.
 *
 * It is pure over a `ProcessInfo[]`, so every rule can be pinned without a live
 * process table — and the rules pinned here are the ones that fail SILENTLY: a
 * CPU rate computed against the wrong baseline still renders a number, and a
 * process in the wrong group still renders a row. Neither shows up as an error.
 *
 * Grouping and labelling have their own suites (`groups.test.ts`,
 * `labels.test.ts`); what is pinned here is the sampler's own arithmetic — the
 * process set, the rate, the rollups and the history.
 */

import { describe, expect, test } from 'bun:test';

import type { DaemonEntry } from './daemons';
import type { ProcessInfo } from './proc/types';
import { createSampler, type SampleDeps } from './sampler';

const SERVER_PID = 100;

function proc(pid: number, ppid: number, argv: string[] | null, extra: Partial<ProcessInfo> = {}): ProcessInfo {
  return { pid, ppid, rss: 1024, cpuNs: 0, threads: 1, argv, cwd: null, startedAt: 1, ...extra };
}

/** A probe whose table the test controls, so the sampler's math is deterministic. */
function fakeProbe(rows: ProcessInfo[]) {
  return { name: 'fake', supported: true, list: () => rows };
}

function deps(rows: ProcessInfo[], overrides: Partial<SampleDeps> = {}): SampleDeps {
  const clock = 1_000;
  return {
    serverPid: SERVER_PID,
    now: () => clock,
    probe: fakeProbe(rows),
    readDaemons: () => [],
    includeDaemons: false,
    historyPoints: 5,
    // No leases by default: every rpc-ui host reads as a prewarm unless a test
    // supplies one, which is exactly what a fresh pool looks like.
    readLease: () => null,
    ...overrides,
  };
}

describe('createSampler', () => {
  test('the first sample reports no CPU rate rather than zero', () => {
    const sampler = createSampler(deps([proc(SERVER_PID, 1, ['bun', '--ompchamber-server'], { rss: 2048, cpuNs: 5e6 })]));
    const snapshot = sampler.sample();
    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.rows[0].rss).toBe(2048);
    // A rate needs two readings. `0` would claim the process is idle.
    expect(snapshot.rows[0].cpuPercent).toBeNull();
    expect(snapshot.total.cpuPercent).toBe(0);
  });

  test('the second sample reports the rate over the elapsed wall time', () => {
    // 500 ms of CPU over 1000 ms of wall is 50%. The tick unit is the probe's
    // business; the sampler only subtracts.
    const rows: ProcessInfo[] = [proc(SERVER_PID, 1, ['bun', '--ompchamber-server'], { cpuNs: 0 })];
    let clock = 1_000;
    const sampler = createSampler(deps(rows, { now: () => clock }));
    sampler.sample();
    rows[0].cpuNs = 500e6;
    clock += 1_000;
    const second = sampler.sample();
    expect(second.rows[0].cpuPercent).toBeCloseTo(50, 5);
  });

  test('a process that appeared since the last sweep has no rate', () => {
    const rows: ProcessInfo[] = [proc(SERVER_PID, 1, ['bun', '--ompchamber-server'])];
    let clock = 1_000;
    const sampler = createSampler(deps(rows, { now: () => clock }));
    sampler.sample();
    rows.push(proc(101, SERVER_PID, ['/bin/zsh', '-i'], { cpuNs: 1e9 }));
    clock += 1_000;
    const second = sampler.sample();
    const fresh = second.rows.find((row) => row.pid === 101);
    expect(fresh?.cpuPercent).toBeNull();
  });

  test('the process set is the tree PLUS the daemon subtrees, deduped', () => {
    // The load-bearing union: broker 199 is parented to 1, so a tree walk from
    // the server cannot reach it — and its Chromium is where the memory is.
    const daemons: DaemonEntry[] = [
      { name: 'omp.browser.headless', pid: 200, state: 'ready', projectDir: '/p', brokerPid: 199 },
    ];
    const rows: ProcessInfo[] = [
      proc(SERVER_PID, 1, ['bun', '--ompchamber-server'], { rss: 100 }),
      proc(101, SERVER_PID, ['bun', '/bin/omp', '--mode', 'rpc-ui'], { rss: 200 }),
      proc(199, 1, ['bun', 'cli.js', '__omp_worker_daemon_broker'], { rss: 300 }),
      proc(200, 199, ['/path/chrome'], { rss: 400 }),
      proc(201, 200, ['/path/chrome-helper'], { rss: 500 }),
      proc(999, 1, ['/unrelated'], { rss: 9000 }),
    ];
    const sampler = createSampler(deps(rows, { includeDaemons: true, readDaemons: () => daemons }));
    const snapshot = sampler.sample();
    const pids = snapshot.rows.map((row) => row.pid).sort((a, b) => a - b);
    expect(pids).toEqual([SERVER_PID, 101, 199, 200, 201]);
    expect(snapshot.total.processes).toBe(5);
    expect(snapshot.total.rss).toBe(1500);
    // Deduped: pid 199 is reached by the daemon walk AND (via its own child
    // chain) by nothing else, but the browser subtree must appear once each.
    expect(new Set(pids).size).toBe(pids.length);
  });

  test('the daemon registry is not consulted when it is switched off', () => {
    const rows: ProcessInfo[] = [
      proc(SERVER_PID, 1, ['bun', '--ompchamber-server']),
      proc(199, 1, ['bun', 'cli.js', '__omp_worker_daemon_broker'], { rss: 300 }),
    ];
    let reads = 0;
    const sampler = createSampler(
      deps(rows, {
        includeDaemons: false,
        readDaemons: () => {
          reads += 1;
          return [];
        },
      }),
    );
    const snapshot = sampler.sample();
    expect(reads).toBe(0);
    expect(snapshot.rows.map((row) => row.pid)).toEqual([SERVER_PID]);
  });

  test('a session and its children roll up into ONE group', () => {
    // The group's figures are the whole subtree's, which is the number a reader
    // cannot get by adding rows up by eye.
    const rows: ProcessInfo[] = [
      proc(SERVER_PID, 1, ['bun', '--ompchamber-server'], { rss: 100 }),
      proc(101, SERVER_PID, ['bun', 'omp', '--mode', 'rpc-ui'], { rss: 200 }),
      proc(102, 101, ['node', '/p/mcp.js'], { rss: 300 }),
    ];
    const sampler = createSampler(deps(rows));
    const snapshot = sampler.sample();
    const host = snapshot.groups.find((group) => group.key === 'prewarm:101');
    expect(host).toBeDefined();
    expect(host?.processes).toBe(2);
    expect(host?.rss).toBe(500);
    // The rows carry the same key, so the table can group them.
    expect(snapshot.rows.find((row) => row.pid === 102)?.groupKey).toBe('prewarm:101');
  });

  test('a lease turns a host group into a session group', () => {
    const rows: ProcessInfo[] = [
      proc(SERVER_PID, 1, ['bun', '--ompchamber-server']),
      proc(101, SERVER_PID, ['bun', 'omp', '--mode', 'rpc-ui']),
    ];
    const leases = new Map([[101, '01a13ceb-bb58-7351-baa5-30abb45cad14']]);
    const sampler = createSampler(deps(rows, { readLease: (pid) => leases.get(pid) ?? null }));
    const snapshot = sampler.sample();
    expect(snapshot.groups.find((group) => group.ownerPid === 101)?.kind).toBe('session');
  });

  test('a group header is the OWNER label, not the first member encountered', () => {
    const rows: ProcessInfo[] = [
      proc(SERVER_PID, 1, ['bun', '--ompchamber-server']),
      proc(101, SERVER_PID, ['bun', 'omp', '--mode', 'rpc-ui'], { cwd: '/Users/me/proj' }),
      proc(102, 101, ['node', '/p/mcp.js']),
    ];
    const sampler = createSampler(deps(rows));
    const snapshot = sampler.sample();
    const host = snapshot.groups.find((group) => group.key === 'prewarm:101');
    // The owner is an omp host, so its title is the prewarm wording — never
    // `codegraph MCP`, which is what the child would have given it.
    expect(host?.title).toBe('prewarm (idle host)');
    expect(host?.ownerPid).toBe(101);
  });

  test('history is bounded and absent when disabled', () => {
    const rows: ProcessInfo[] = [proc(SERVER_PID, 1, ['bun', '--ompchamber-server'], { rss: 1024 })];
    const sampler = createSampler(deps(rows, { historyPoints: 3 }));
    for (let i = 0; i < 6; i += 1) sampler.sample();
    const bounded = sampler.sample();
    expect(bounded.history?.rss).toHaveLength(3);

    const noHistory = createSampler(deps(rows, { historyPoints: 0 })).sample();
    expect(noHistory.history).toBeUndefined();
  });

  test('an unsupported probe reports its reason instead of an empty table', () => {
    const sampler = createSampler(
      deps([], {
        probe: { name: 'win32', supported: false, reason: 'no subprocess-free route', list: () => [] },
      }),
    );
    const snapshot = sampler.sample();
    expect(snapshot.rows).toHaveLength(0);
    expect(snapshot.groups).toHaveLength(0);
    expect(snapshot.error).toContain('no subprocess-free route');
    expect(snapshot.probe.supported).toBe(false);
  });
});
