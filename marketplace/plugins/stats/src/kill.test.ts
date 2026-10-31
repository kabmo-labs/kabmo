/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The kill rules. Each refusal here is a way a panel button could destroy
 * something the user did not point at, so the tests are about the refusals
 * more than about the happy path:
 *
 *  - `0` and `-1` are process-group / machine-wide signals to `kill(2)`, and a
 *    JSON body can carry either;
 *  - the server that HOSTS this panel is a row in the table, so its own pid has
 *    to be refused by name rather than by absence;
 *  - a pid read off a stale table may have been recycled, so membership is
 *    checked against a fresh sample, and a signal that is never called is the
 *    proof.
 */

import { describe, expect, test } from 'bun:test';

import { killStackProcess } from './kill';
import type { ProcessRow, StatsSnapshot } from './snapshot';

const SERVER_PID = 100;

function row(pid: number, title = `process ${pid}`): ProcessRow {
  return {
    pid,
    ppid: pid === SERVER_PID ? 1 : SERVER_PID,
    title,
    detail: 'detail',
    groupKey: 'session',
    depth: pid === SERVER_PID ? 0 : 1,
    memory: 1024,
    memorySource: 'footprint',
    rss: 2048,
    cpuPercent: null,
    threads: 1,
  };
}

function snapshot(pids: number[]): StatsSnapshot {
  const rows = pids.map((pid) => row(pid));
  return {
    sampledAt: 0,
    probe: { name: 'fake', supported: true },
    rows,
    groups: [],
    total: { processes: rows.length, memory: 1024 * rows.length, cpuPercent: 0 },
    memorySource: 'footprint',
    machine: { totalMemBytes: 1, freeMemBytes: 1, cpuCount: 1, loadPerCore: 0 },
    daemons: [],
    serverPid: SERVER_PID,
  };
}

/** Deps whose `signal` records instead of killing, so a test cannot hurt the runner. */
function deps(pids: number[], signal?: (pid: number, sig: 'SIGTERM') => void) {
  const calls: Array<{ pid: number; signal: string }> = [];
  return {
    calls,
    value: {
      sample: () => snapshot(pids),
      serverPid: SERVER_PID,
      signal: signal ?? ((pid: number, sig: 'SIGTERM') => calls.push({ pid, signal: sig })),
    },
  };
}

describe('killStackProcess', () => {
  test('signals a pid the fresh sample measured', () => {
    const { calls, value } = deps([SERVER_PID, 101]);
    expect(killStackProcess(101, value)).toEqual({ killed: true, pid: 101, title: 'process 101', signal: 'SIGTERM' });
    expect(calls).toEqual([{ pid: 101, signal: 'SIGTERM' }]);
  });

  test('refuses the process group (0), the machine (-1) and init (1)', () => {
    for (const pid of [0, -1, 1]) {
      const { calls, value } = deps([SERVER_PID, 101]);
      const outcome = killStackProcess(pid, value);
      expect(outcome.killed).toBe(false);
      expect(calls).toHaveLength(0);
    }
  });

  test('refuses a non-integer or non-number pid', () => {
    for (const pid of [1.5, '101', null, undefined, { pid: 101 }]) {
      const { calls, value } = deps([SERVER_PID, 101]);
      expect(killStackProcess(pid, value).killed).toBe(false);
      expect(calls).toHaveLength(0);
    }
  });

  test('refuses the Kabmo server even though it is a row in the table', () => {
    const { calls, value } = deps([SERVER_PID, 101]);
    const outcome = killStackProcess(SERVER_PID, value);
    expect(outcome.killed).toBe(false);
    expect(outcome.killed === false && outcome.reason).toContain('kabmo stop');
    expect(calls).toHaveLength(0);
  });

  test('refuses a pid outside the measured union — a stale row may be recycled', () => {
    const { calls, value } = deps([SERVER_PID, 101]);
    const outcome = killStackProcess(999, value);
    expect(outcome.killed).toBe(false);
    expect(calls).toHaveLength(0);
  });

  test('an already-exited pid is a refusal, not a thrown error', () => {
    const { value } = deps([SERVER_PID, 101], () => {
      const error = new Error('kill ESRCH') as NodeJS.ErrnoException;
      error.code = 'ESRCH';
      throw error;
    });
    const outcome = killStackProcess(101, value);
    expect(outcome.killed).toBe(false);
    expect(outcome.killed === false && outcome.reason).toContain('already exited');
  });

  test('a process owned by another user says so', () => {
    const { value } = deps([SERVER_PID, 101], () => {
      const error = new Error('kill EPERM') as NodeJS.ErrnoException;
      error.code = 'EPERM';
      throw error;
    });
    const outcome = killStackProcess(101, value);
    expect(outcome.killed).toBe(false);
    expect(outcome.killed === false && outcome.reason).toContain('another user');
  });
});