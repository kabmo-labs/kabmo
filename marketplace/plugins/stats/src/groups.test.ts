/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The grouping rules, against synthetic trees.
 *
 * Each rule pinned here was measured against a real tree, and each fails
 * silently: a process in the wrong group still renders, it is just attributed
 * to the wrong session — which is worse than a missing row, because the number
 * looks authoritative.
 */

import { describe, expect, test } from 'bun:test';

import type { DaemonEntry } from './daemons';
import { assignGroups } from './groups';
import type { ProcessInfo } from './proc/types';

const SERVER_PID = 100;

function proc(pid: number, ppid: number, argv: string[] | null): ProcessInfo {
  return { pid, ppid, rss: 1024, cpuNs: 0, threads: 1, argv, cwd: null, startedAt: 1 };
}

function daemon(name: string, pid: number, brokerPid: number | null, state = 'ready'): DaemonEntry {
  return { name, pid, state, projectDir: '/p', brokerPid };
}

describe('assignGroups', () => {
  test('a direct child of Kabmo is its own group root', () => {
    const list = [
      proc(SERVER_PID, 1, ['bun', '--kabmo-server']),
      proc(101, SERVER_PID, ['bun', 'omp', '--mode', 'rpc-ui']),
      proc(102, SERVER_PID, ['/bin/zsh', '-i']),
    ];
    const groups = assignGroups(list, { serverPid: SERVER_PID, daemons: [] });
    expect(groups.get(SERVER_PID)?.kind).toBe('kabmo');
    expect(groups.get(101)?.kind).toBe('prewarm');
    expect(groups.get(102)?.kind).toBe('terminal');
    // Two DIFFERENT groups, not one bucket.
    expect(groups.get(101)?.key).not.toBe(groups.get(102)?.key);
  });

  test('the lease decides session vs prewarm, never argv', () => {
    // argv is identical for both; only the lease separates them. Measured: a
    // host that adopted a prewarm keeps the prewarm's argv for its whole life.
    const argv = ['bun', 'omp', '--mode', 'rpc-ui', '--cwd', '/p'];
    const list = [proc(SERVER_PID, 1, ['bun', '--kabmo-server']), proc(101, SERVER_PID, argv), proc(102, SERVER_PID, argv)];
    const leases = new Map([[101, '01a13ceb-bb58-7351-baa5-30abb45cad14']]);
    const groups = assignGroups(list, { serverPid: SERVER_PID, daemons: [], leases });
    expect(groups.get(101)?.kind).toBe('session');
    expect(groups.get(102)?.kind).toBe('prewarm');
  });

  test('`--no-session` is a utility, not a prewarm', () => {
    const list = [
      proc(SERVER_PID, 1, ['bun', '--kabmo-server']),
      proc(101, SERVER_PID, ['bun', 'omp', '--mode', 'rpc-ui', '--no-session', '--no-lsp']),
    ];
    const groups = assignGroups(list, { serverPid: SERVER_PID, daemons: [] });
    expect(groups.get(101)?.kind).toBe('utility');
  });

  test('a daemon root is a group even when parented to 1', () => {
    // The broker is detached and reparented, so a tree walk cannot see it.
    const list = [
      proc(SERVER_PID, 1, ['bun', '--kabmo-server']),
      proc(199, 1, ['bun', 'cli.js', '__omp_worker_daemon_broker']),
      proc(200, 199, ['/p/chrome']),
      proc(201, 200, ['/p/chrome-helper']),
    ];
    const daemons = [daemon('omp.browser.headless', 200, 199)];
    const groups = assignGroups(list, { serverPid: SERVER_PID, daemons });
    expect(groups.get(200)?.kind).toBe('daemon');
    expect(groups.get(200)?.key).toBe('daemon:omp.browser.headless');
    // The whole subtree, including the grandchildren, belongs to it.
    expect(groups.get(201)?.key).toBe('daemon:omp.browser.headless');
    expect(groups.get(201)?.depth).toBe(1);
  });

  test('a broker serving several daemons gets its OWN group', () => {
    // Measured: one broker supervised headed + headless + lsp.mux, so folding
    // it into whichever daemon a map named first was arbitrary.
    const list = [
      proc(SERVER_PID, 1, ['bun', '--kabmo-server']),
      proc(199, 1, ['bun', 'cli.js', '__omp_worker_daemon_broker']),
      proc(200, 199, ['/p/chrome-headless']),
      proc(210, 199, ['/p/chrome-headed']),
    ];
    const daemons = [daemon('omp.browser.headless', 200, 199), daemon('omp.browser.headed', 210, 199)];
    const groups = assignGroups(list, { serverPid: SERVER_PID, daemons });
    expect(groups.get(199)?.kind).toBe('broker');
    expect(groups.get(199)?.key).toBe('broker:199');
    // Each daemon keeps its own group, named by its own registry entry.
    expect(groups.get(200)?.key).toBe('daemon:omp.browser.headless');
    expect(groups.get(210)?.key).toBe('daemon:omp.browser.headed');
  });

  test('a broker a session spawned stays INSIDE that session', () => {
    // Measured: pid 66310 was a broker under a prewarm. The direct-child test
    // must run before the registry test, or it is split out of its owner.
    const list = [
      proc(SERVER_PID, 1, ['bun', '--kabmo-server']),
      proc(101, SERVER_PID, ['bun', 'omp', '--mode', 'rpc-ui']),
      proc(102, 101, ['bun', 'cli.js', '__omp_worker_daemon_broker']),
      proc(103, 102, ['bun', 'cli.js', 'browser-relay', '--port', '9224']),
    ];
    const groups = assignGroups(list, { serverPid: SERVER_PID, daemons: [] });
    expect(groups.get(101)?.kind).toBe('prewarm');
    expect(groups.get(102)?.key).toBe(groups.get(101)?.key);
    expect(groups.get(103)?.key).toBe(groups.get(101)?.key);
    expect(groups.get(103)?.depth).toBe(2);
  });

  test('a daemon entry with no live pid invents no group', () => {
    // The registry keeps every daemon a project ever started (63 entries here,
    // mostly `exited`); treating those as roots would add empty groups.
    const list = [proc(SERVER_PID, 1, ['bun', '--kabmo-server'])];
    const daemons = [daemon('omp.browser.headless', 999, 998, 'exited')];
    const groups = assignGroups(list, { serverPid: SERVER_PID, daemons });
    expect(groups.size).toBe(1);
    expect(groups.get(SERVER_PID)?.key).toBe('kabmo');
  });

  test('depth counts steps from the owner, and the owner is 0', () => {
    const list = [
      proc(SERVER_PID, 1, ['bun', '--kabmo-server']),
      proc(101, SERVER_PID, ['bun', 'omp', '--mode', 'rpc-ui']),
      proc(102, 101, ['node', '/p/mcp.js']),
      proc(103, 102, ['node', '-e', 'watchdog']),
    ];
    const groups = assignGroups(list, { serverPid: SERVER_PID, daemons: [] });
    expect(groups.get(101)?.depth).toBe(0);
    expect(groups.get(102)?.depth).toBe(1);
    expect(groups.get(103)?.depth).toBe(2);
  });

  test('a parent cycle terminates and still assigns', () => {
    const list = [proc(SERVER_PID, 1, ['bun', '--kabmo-server']), proc(101, 102, ['/a']), proc(102, 101, ['/b'])];
    const groups = assignGroups(list, { serverPid: SERVER_PID, daemons: [] });
    // Neither reaches Kabmo, so each keeps its own key — but the call
    // returns rather than looping.
    expect(groups.size).toBe(3);
  });

  test('an unplaceable process is still assigned', () => {
    const list = [proc(SERVER_PID, 1, ['bun', '--kabmo-server']), proc(500, 4000, ['/orphan'])];
    const groups = assignGroups(list, { serverPid: SERVER_PID, daemons: [] });
    expect(groups.get(500)?.key).toBe('other');
  });
});
