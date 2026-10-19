/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Ending a process TREE, on both platforms' mechanisms.
 *
 * The Windows branch shells out to `taskkill /pid <pid> /t`, and that spawn can
 * fail on its own: measured, `Bun.spawn` THROWS `Executable not found in $PATH`
 * when the binary is missing, which escaped `killChildTree` as an exception from
 * a stop that was otherwise working — the caller's escalation never ran and the
 * tree survived. The fallback is the single-PID kill, so a host without
 * `taskkill` loses the tree kill, not the stop.
 *
 * The Windows branch is reached from macOS through the `spawn` seam the function
 * exposes (Bun resolves a child's executable from the PATH snapshot taken at
 * process start, so a stub binary cannot be injected through PATH — verified).
 * What the seam proves is the branch's own decisions: throw → fallback, non-zero
 * exit → fallback, success → no double kill, and the escalation the caller sees.
 * A real child is used wherever the real mechanism is the POSIX one.
 */

import { afterEach, describe, expect, test } from 'bun:test';

import { isGroupKillable, killChildTree, terminateChildProcess } from '@/cli/lib/process-lifecycle.js';
import { describePosix } from '@/test-support/platform';

const children = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    try { child.kill('SIGKILL'); } catch {}
    await child.exited;
  }
});

function spawnSleep() {
  const child = Bun.spawn(['/bin/sh', '-c', 'trap "" TERM; sleep 60'], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
  children.push(child);
  return child;
}

/** A process object that records what was signalled instead of doing it. */
function fakeChild(pid = 4242) {
  const signals = [];
  return { pid, signals, kill: (signal) => { signals.push(signal); } };
}

/**
 * A stand-in for `Bun.spawn` on the win32 branch. `exitCode` is what the fake
 * `taskkill` reports; `throws` models the missing binary.
 */
function fakeSpawn({ exitCode = 0, throws = false } = {}) {
  const calls = [];
  const fn = (options) => {
    calls.push(options);
    if (throws) throw new Error('Executable not found in $PATH: "taskkill"');
    return { exited: Promise.resolve(exitCode), unref: () => {} };
  };
  fn.calls = calls;
  return fn;
}

describe('isGroupKillable', () => {
  // The guard exists because POSIX reserves `kill(-1)` for "every process this
  // user may signal": a stale record naming PID 1 (or 0) would otherwise turn
  // `kabmo stop` into a signal to the whole session — observed, and far
  // worse than a stop that fails.
  test('refuses the PIDs that make a group kill catastrophic', () => {
    expect(isGroupKillable(0)).toBe(false);
    expect(isGroupKillable(1)).toBe(false);
    expect(isGroupKillable(-1)).toBe(false);
    expect(isGroupKillable(Number.NaN)).toBe(false);
    expect(isGroupKillable(undefined)).toBe(false);
    expect(isGroupKillable('1')).toBe(false);
  });

  test('allows a real process group leader', () => {
    expect(isGroupKillable(2)).toBe(true);
    expect(isGroupKillable(process.pid)).toBe(true);
  });
});

describe('killChildTree on win32', () => {
  test('runs taskkill with the tree and force flags', () => {
    const spawn = fakeSpawn({ exitCode: 0 });
    killChildTree(fakeChild(99), true, 'win32', 'SIGTERM', spawn);

    expect(spawn.calls).toHaveLength(1);
    expect(spawn.calls[0].cmd).toEqual(['taskkill', '/pid', '99', '/t', '/f']);
    expect(spawn.calls[0].windowsHide).toBe(true);
  });

  test('omits /f when not forced', () => {
    const spawn = fakeSpawn({ exitCode: 0 });
    killChildTree(fakeChild(99), false, 'win32', 'SIGTERM', spawn);

    expect(spawn.calls[0].cmd).toEqual(['taskkill', '/pid', '99', '/t']);
  });

  test('falls back to the single-PID kill when taskkill cannot be spawned', () => {
    // The regression: before the fix this THREW out of a stop that was
    // otherwise working, so the caller's escalation never ran.
    const child = fakeChild();
    expect(() => killChildTree(child, true, 'win32', 'SIGTERM', fakeSpawn({ throws: true }))).not.toThrow();
    expect(child.signals).toEqual(['SIGKILL']);
  });

  test('falls back when taskkill exits non-zero', async () => {
    const child = fakeChild();
    killChildTree(child, true, 'win32', 'SIGTERM', fakeSpawn({ exitCode: 1 }));
    await Bun.sleep(20);
    expect(child.signals).toEqual(['SIGKILL']);
  });

  test('does not double-kill when taskkill succeeded', async () => {
    const child = fakeChild();
    killChildTree(child, true, 'win32', 'SIGTERM', fakeSpawn({ exitCode: 0 }));
    await Bun.sleep(20);
    expect(child.signals).toEqual([]);
  });

  test('a reaper that rejects is treated as a failure', async () => {
    const child = fakeChild();
    const spawn = () => ({ exited: Promise.reject(new Error('boom')), unref: () => {} });
    killChildTree(child, true, 'win32', 'SIGTERM', spawn);
    await Bun.sleep(20);
    expect(child.signals).toEqual(['SIGKILL']);
  });
});

describePosix('terminateChildProcess', () => {
  test('ends a real child through the win32 fallback', async () => {
    const child = spawnSleep();

    expect(await terminateChildProcess(child, 3000, 'win32', fakeSpawn({ throws: true }))).toBe(true);
    await child.exited;
    expect(child.signalCode).toBe('SIGKILL');
  });

  test('an already-exited child answers true without signalling', async () => {
    const child = Bun.spawn(['/bin/sh', '-c', 'exit 0'], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
    children.push(child);
    await child.exited;

    expect(await terminateChildProcess(child, 100, 'win32', fakeSpawn({ throws: true }))).toBe(true);
  });

  test('the posix branch signals the process group', async () => {
    const child = spawnSleep();
    expect(await terminateChildProcess(child, 3000, 'linux')).toBe(true);
    await child.exited;
    expect(child.signalCode).toBe('SIGKILL');
  });
});
