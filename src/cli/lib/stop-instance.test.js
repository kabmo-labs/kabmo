/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `stopInstance` — the one place a running server is ended, and the one place
 * the CLI could report a stop that never happened.
 *
 * Two failures are pinned here, both measured on Windows and both invisible to
 * a test that only checks the returned boolean:
 *
 *   1. Identity could not be read (`getProcessState` answers `unknown` on every
 *      Windows PID) and that was read as "not ours", so the early return deleted
 *      the record and answered `true` without signalling anything.
 *      `kabmo stop` printed "✓ Stopped" while the port stayed bound.
 *   2. The record was dropped even when the process survived, which removed the
 *      only handle `listLiveInstances` has: `status` then said "not running"
 *      while `serve` — which probes the port — refused to start.
 *
 * The world is injected (`deps`), never mocked and never signalled. That is not
 * only about `mock.module` swapping the probe for the whole `bun test` run: on
 * POSIX the real kill is a GROUP kill (`-pid`), so a test that lets it run
 * reaches the runner's own process group — which it did, and it is why every
 * case below drives `signal` instead of a real process. The cases that must
 * touch the real mechanism (a listener answering `/api/health`, the escalation
 * past a signal a child ignores) live in `process-lifecycle.test.js`.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { stopInstance } from '@/cli/lib/stop-instance.js';
import { readInstanceRecord, writeInstanceRecord } from '@/server/lib/lifecycle/instance';
import { win32Probe } from '@/server/lib/lifecycle/proc/win32';

let workRoot = '';
let originalDataDir;

beforeAll(() => {
  workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-stop-test-'));
  originalDataDir = Bun.env.KABMO_DATA_DIR;
  Bun.env.KABMO_DATA_DIR = workRoot;
});

afterAll(() => {
  if (originalDataDir === undefined) delete Bun.env.KABMO_DATA_DIR;
  else Bun.env.KABMO_DATA_DIR = originalDataDir;
  fs.rmSync(workRoot, { recursive: true, force: true });
});

afterEach(() => {
  fs.rmSync(path.join(workRoot, 'run'), { recursive: true, force: true });
});

/**
 * A fake process table: liveness is whatever the case set, and `signal` records
 * what was asked of it. `diesOn` names the signal that ends it, so the
 * escalation path is exercised without a real kill.
 */
function fakeWorld({ pid, alive = true, diesOn = 'SIGTERM', occupantPid = pid } = {}) {
  const signals = [];
  const state = { alive };
  return {
    signals,
    state,
    deps: {
      // Windows: no command line is reachable, so identity is never `matched`.
      getProcessState: () => 'unknown',
      findOccupant: async () => (occupantPid === null ? null : { pid: occupantPid }),
      isAlive: () => state.alive,
      signal: (_pid, force) => {
        const signal = force ? 'SIGKILL' : 'SIGTERM';
        signals.push(signal);
        if (diesOn && signal === diesOn) state.alive = false;
      },
    },
  };
}

function writeRecord(port, pid) {
  writeInstanceRecord({
    pid, port, host: '127.0.0.1', mode: 'prod', launchMode: 'daemon',
    startedAt: new Date().toISOString(), version: '0.0.0',
  });
}

describe('stopInstance', () => {
  test('the Windows premise: identity is unreadable, so it is never `matched`', () => {
    // Everything below exists because of this one fact about `proc/win32.ts`.
    expect(win32Probe.commandLine(process.pid)).toBeNull();
  });

  test('stops a record-only entry when identity is unreadable (the Windows case)', async () => {
    const port = 4931;
    writeRecord(port, 5001);
    const world = fakeWorld({ pid: 5001 });

    const gone = await stopInstance({ port, pid: 5001, source: 'registry' }, { timeoutMs: 300, deps: world.deps });

    expect(gone).toBe(true);
    // The regression: before the fix this returned true having sent NOTHING,
    // because `unknown` was read as "not ours".
    expect(world.signals).toEqual(['SIGTERM']);
    expect(readInstanceRecord(port)).toBeNull();
  });

  test('never signals a stranger holding a recycled PID, and drops the stale record', async () => {
    const port = 4932;
    writeRecord(port, 5002);
    // The port answers for a DIFFERENT PID: the record is stale, and the live
    // PID it names belongs to something else.
    const world = fakeWorld({ pid: 5002, occupantPid: 9999 });

    const gone = await stopInstance({ port, pid: 5002, source: 'registry' }, { timeoutMs: 300, deps: world.deps });

    expect(gone).toBe(true);
    expect(world.signals).toEqual([]);
    expect(readInstanceRecord(port)).toBeNull();
  });

  test('never signals a record-only entry when nothing occupies the port', async () => {
    const port = 4933;
    writeRecord(port, 5003);
    const world = fakeWorld({ pid: 5003, occupantPid: null });

    const gone = await stopInstance({ port, pid: 5003, source: 'registry' }, { timeoutMs: 300, deps: world.deps });

    expect(gone).toBe(true);
    expect(world.signals).toEqual([]);
    expect(readInstanceRecord(port)).toBeNull();
  });

  test('stops the instance when the port names the same PID', async () => {
    const port = 4934;
    writeRecord(port, 5004);
    const world = fakeWorld({ pid: 5004 });

    const gone = await stopInstance({ port, pid: 5004, source: 'registry' }, { timeoutMs: 300, deps: world.deps });

    expect(gone).toBe(true);
    expect(world.signals).toEqual(['SIGTERM']);
  });

  test('escalates to SIGKILL when the graceful signal does not take', async () => {
    const port = 4935;
    writeRecord(port, 5005);
    const world = fakeWorld({ pid: 5005, diesOn: 'SIGKILL' });

    const gone = await stopInstance({ port, pid: 5005, source: 'registry' }, { timeoutMs: 0, deps: world.deps });

    expect(gone).toBe(true);
    expect(world.signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(readInstanceRecord(port)).toBeNull();
  });

  test('keeps the record when the process survives, so the next status still finds it', async () => {
    const port = 4936;
    writeRecord(port, 5006);
    // `diesOn: null` models the process nothing can end: both signals are sent,
    // neither takes, and the record must survive so `status` still reports it.
    const world = fakeWorld({ pid: 5006, diesOn: null });

    const gone = await stopInstance({ port, pid: 5006, source: 'registry' }, { timeoutMs: 0, deps: world.deps });

    expect(gone).toBe(false);
    expect(world.signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(readInstanceRecord(port)).not.toBeNull();
  });

  test('an entry confirmed by the port probe needs no identity', async () => {
    const port = 4937;
    writeRecord(port, 5007);
    // `source: 'probe'` is the server itself having answered /api/health: the
    // guard is skipped entirely, which is why `stop --port <port>` still worked
    // on Windows while the record-only path did not.
    const world = fakeWorld({ pid: 5007, occupantPid: null });

    const gone = await stopInstance({ port, pid: 5007, source: 'probe' }, { timeoutMs: 300, deps: world.deps });

    expect(gone).toBe(true);
    expect(world.signals).toEqual(['SIGTERM']);
  });

  test('an already-dead PID just clears the record', async () => {
    const port = 4938;
    writeRecord(port, 5008);
    const world = fakeWorld({ pid: 5008, alive: false });

    expect(await stopInstance({ port, pid: 5008, source: 'registry' }, { timeoutMs: 100, deps: world.deps })).toBe(true);
    expect(world.signals).toEqual([]);
    expect(readInstanceRecord(port)).toBeNull();
  });

  test('an entry with no port is never signalled, since nothing can confirm it', async () => {
    const world = fakeWorld({ pid: 5009, occupantPid: null });

    // Degenerate input: every real caller passes an instance entry, which always
    // carries a port. With no port there is nothing to check the PID against, so
    // the conservative direction is kept — an unconfirmed PID is not signalled.
    expect(await stopInstance({ pid: 5009 }, { timeoutMs: 300, deps: world.deps })).toBe(true);
    expect(world.signals).toEqual([]);
  });
});
