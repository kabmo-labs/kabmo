/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The classifier and the sampler, against synthetic process tables.
 *
 * Both modules are pure over a `ProcessInfo[]`, so every rule can be pinned
 * without a live process table — and the rules pinned here are the ones that
 * fail SILENTLY in the app: a category that lands on `other` still renders a
 * row, and a CPU rate computed against the wrong baseline still renders a
 * number. Neither shows up as an error.
 */

import { describe, expect, test } from 'bun:test';

import { classifyProcesses, type DaemonEntry } from './classify';
import type { ProcessInfo } from './proc/types';
import { createSampler, type SampleDeps } from './sampler';

const SERVER_PID = 100;

function proc(pid: number, ppid: number, argv: string[] | null, extra: Partial<ProcessInfo> = {}): ProcessInfo {
  return { pid, ppid, rss: 1024, cpuNs: 0, threads: 1, argv, ...extra };
}

function options(daemons: DaemonEntry[] = []) {
  return { serverPid: SERVER_PID, shellNames: ['zsh', 'bash', 'sh'], daemons };
}

describe('classifyProcesses', () => {
  test('names the chamber, an omp child, a daemon broker, a terminal and the worker', () => {
    const list: ProcessInfo[] = [
      proc(SERVER_PID, 1, ['bun', 'dist/client/index.js', '--ompchamber-server']),
      proc(101, SERVER_PID, ['bun', '/bin/omp', '--mode', 'rpc-ui', '--cwd', '/x']),
      proc(102, SERVER_PID, ['/bin/zsh', '-i']),
      proc(103, SERVER_PID, ['bun', 'dist/cli.js', '__omp_worker_stt']),
      proc(104, 1, ['osascript', '-l', 'JavaScript', '/data/tray/host/darwin.js', '/data/tray/3000.config.json']),
      proc(105, 1, ['/usr/bin/some-other-thing']),
    ];
    const categories = classifyProcesses(list, options());
    expect(categories.get(SERVER_PID)).toBe('chamber');
    expect(categories.get(101)).toBe('omp');
    expect(categories.get(102)).toBe('terminal');
    expect(categories.get(103)).toBe('dictation');
    expect(categories.get(104)).toBe('tray');
    expect(categories.get(105)).toBe('other');
  });

  test('the tree root is the chamber by identity, whatever its argv says', () => {
    // The failure this pins: deciding the chamber from argv made the label
    // depend on how the server was launched, so a wrapper (`bun run
    // src/server/index.ts`) left the one process a reader looks for first
    // unlabelled.
    const list: ProcessInfo[] = [
      proc(SERVER_PID, 1, ['bun', 'run', 'src/server/index.ts']),
      proc(101, SERVER_PID, ['/bin/zsh', '-i']),
    ];
    const categories = classifyProcesses(list, options());
    expect(categories.get(SERVER_PID)).toBe('chamber');
  });

  test('a daemon label covers the whole subtree, named after the daemon', () => {
    // The registered pid is the BROKER; the memory is in the Chromium it
    // supervises. Labelling only the registered pid would report the browser's
    // cost as `other`, which is the bug this test exists for.
    const daemons: DaemonEntry[] = [
      { name: 'omp.browser.headless', pid: 200, state: 'ready', projectDir: '/p', brokerPid: 199 },
    ];
    const list: ProcessInfo[] = [
      proc(SERVER_PID, 1, ['bun', '--ompchamber-server']),
      proc(199, 1, ['bun', 'cli.js', '__omp_worker_daemon_broker']),
      proc(200, 199, ['/path/Google Chrome for Testing', '--headless']),
      proc(201, 200, ['/path/Google Chrome for Testing Helper', '--type=renderer']),
      proc(202, 201, ['/path/Google Chrome for Testing Helper', '--type=gpu-process']),
    ];
    const categories = classifyProcesses(list, options(daemons));
    expect(categories.get(199)).toBe('daemon:omp.browser.headless');
    expect(categories.get(200)).toBe('daemon:omp.browser.headless');
    expect(categories.get(201)).toBe('daemon:omp.browser.headless');
    expect(categories.get(202)).toBe('daemon:omp.browser.headless');
  });

  test('a shell a tool call started is NOT a terminal', () => {
    // The terminal test keys on the PARENT, not on the executable: an omp child
    // runs `bash` constantly, and labelling those terminals would attribute a
    // tool call's cost to the panel.
    const list: ProcessInfo[] = [
      proc(SERVER_PID, 1, ['bun', '--ompchamber-server']),
      proc(101, SERVER_PID, ['bun', '/bin/omp', '--mode', 'rpc-ui']),
      proc(102, 101, ['bash', '-c', 'npm run build']),
    ];
    const categories = classifyProcesses(list, options());
    expect(categories.get(102)).toBe('omp');
  });

  test('a process with an unreadable argv is counted, not dropped', () => {
    const list: ProcessInfo[] = [
      proc(SERVER_PID, 1, ['bun', '--ompchamber-server']),
      proc(101, 1, null),
    ];
    const categories = classifyProcesses(list, options());
    expect(categories.get(101)).toBe('other');
  });

  test('a parent cycle terminates', () => {
    // A recycled pid can produce a loop in the parent map; the walk must answer
    // rather than hang.
    const list: ProcessInfo[] = [
      proc(SERVER_PID, 1, ['bun', '--ompchamber-server']),
      proc(101, 102, null),
      proc(102, 101, null),
    ];
    const categories = classifyProcesses(list, options());
    expect(categories.size).toBe(3);
  });
});

/** A probe whose table the test controls, so the sampler's math is deterministic. */
function fakeProbe(rows: ProcessInfo[]) {
  return { name: 'fake', supported: true, list: () => rows };
}

function deps(rows: ProcessInfo[], overrides: Partial<SampleDeps> = {}): SampleDeps {
  let clock = 1_000;
  return {
    serverPid: SERVER_PID,
    shellNames: ['zsh', 'bash'],
    now: () => clock,
    probe: fakeProbe(rows),
    readDaemons: () => [],
    includeDaemons: false,
    historyPoints: 5,
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

  test('a bun process is named by its script, not by the runtime', () => {
    const rows: ProcessInfo[] = [
      proc(SERVER_PID, 1, ['bun', '/path/dist/client/index.js', '--ompchamber-server']),
      proc(101, SERVER_PID, ['/bin/zsh', '-i']),
    ];
    const snapshot = createSampler(deps(rows)).sample();
    expect(snapshot.rows.find((row) => row.pid === SERVER_PID)?.command).toBe('index.js');
    expect(snapshot.rows.find((row) => row.pid === 101)?.command).toBe('zsh');
  });

  test('`bun run <script>` names the script, not the subcommand', () => {
    // Measured on a real boot: `bun run src/server/index.ts` labelled the
    // chamber's own row `run`.
    const rows: ProcessInfo[] = [
      proc(SERVER_PID, 1, ['bun', 'run', 'src/server/index.ts']),
      proc(101, SERVER_PID, ['bun', 'run', '/abs/path/boot.ts', '--flag']),
      proc(102, SERVER_PID, ['bun', '-e', 'console.log(1)']),
    ];
    const snapshot = createSampler(deps(rows)).sample();
    const label = (pid: number) => snapshot.rows.find((row) => row.pid === pid)?.command;
    expect(label(SERVER_PID)).toBe('index.ts');
    expect(label(101)).toBe('boot.ts');
    // No script to name: the runtime is the honest answer.
    expect(label(102)).toBe('bun');
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
    expect(snapshot.error).toContain('no subprocess-free route');
    expect(snapshot.probe.supported).toBe(false);
  });
});
