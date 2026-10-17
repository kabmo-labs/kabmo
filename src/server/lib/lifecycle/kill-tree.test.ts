/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Process-tree termination, on both platform branches.
 *
 * The POSIX half needs a real detached child (a group leader) to prove `-pid`
 * reaches it, and that is covered where a child is cheap to spawn. The WINDOWS
 * half cannot run on the machine this repository is developed on, so its argv
 * is driven through injected dependencies instead — the alternative is a branch
 * that is written once and never executed, which is exactly the shape that let
 * three Windows bugs ship.
 *
 * What the Windows cases pin, each of which was a silent failure mode:
 *
 *   - `taskkill /t` is asked for, because only it reaches grandchildren. A
 *     direct `process.kill` would look successful and leave the LSP servers
 *     running.
 *   - `/f` rides along only when the caller asked for force: `SIGTERM` is a
 *     request, and `/f` would turn it into a kill the child cannot refuse.
 *   - a non-zero `taskkill` exit falls back to the direct kill. `taskkill`
 *     reports "could not terminate" with an exit code, and treating that as
 *     success leaves the process alive with nothing to retry.
 *   - a spawn that throws (taskkill absent from PATH) falls back too, and
 *     neither path ever throws — this runs during shutdown.
 */

import { describe, expect, test } from 'bun:test';

import { killProcessTree, type KillTreeDeps } from '@/server/lib/lifecycle/kill-tree';

/** What the Windows branch asked for, plus the promise its fallback rides on. */
interface Harness {
  deps: KillTreeDeps;
  spawned: string[][];
  killed: { pid: number; signal: NodeJS.Signals }[];
  /**
   * Resolves when the `taskkill` branch has finished deciding.
   *
   * The production code chains `reaper.exited.then(...)` and cannot return a
   * promise (it is called from `exit` handlers), so a test has no signal to
   * await. Rather than sleeping — which guesses at a duration and pays it on
   * every run — the fake's own `exited` promise IS the signal: it is resolved
   * by the test, so `settle()` is exact.
   */
  settle: () => Promise<void>;
}

/** Records what the Windows branch asked for, and answers with a chosen code. */
function harness(exitCode: number | null): Harness {
  const spawned: string[][] = [];
  const killed: { pid: number; signal: NodeJS.Signals }[] = [];

  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  // The fallback is chained onto `exited`, so it runs a microtask after the
  // gate opens. Two awaits of an already-resolved promise is the deterministic
  // equivalent of "let the chain drain", with no clock involved.
  const settle = async (): Promise<void> => {
    release();
    await gate;
    await gate;
  };

  const deps: KillTreeDeps = {
    platform: 'win32',
    spawnTaskkill: (cmd) => {
      spawned.push(cmd);
      return { exited: gate.then(() => exitCode) };
    },
    kill: (pid, signal) => killed.push({ pid, signal }),
  };
  return { deps, spawned, killed, settle };
}

/** The same, for a spawn that fails outright. */
function throwingHarness() {
  const killed: { pid: number; signal: NodeJS.Signals }[] = [];
  const deps: KillTreeDeps = {
    platform: 'win32',
    spawnTaskkill: () => null,
    kill: (pid, signal) => killed.push({ pid, signal }),
  };
  return { deps, killed };
}

describe('killProcessTree — Windows', () => {
  test('asks taskkill for the whole tree, by pid', async () => {
    const h = harness(0);
    killProcessTree(4242, false, 'SIGTERM', h.deps);
    await h.settle();

    expect(h.spawned).toEqual([['taskkill', '/pid', '4242', '/t']]);
    expect(h.killed).toEqual([]);
  });

  test('adds /f only when the caller asked to force', async () => {
    const soft = harness(0);
    killProcessTree(1, false, 'SIGTERM', soft.deps);
    const hard = harness(0);
    killProcessTree(1, true, 'SIGKILL', hard.deps);
    await Promise.all([soft.settle(), hard.settle()]);

    expect(soft.spawned[0]).not.toContain('/f');
    expect(hard.spawned[0]).toContain('/f');
  });

  test('a taskkill that could not reach the tree falls back to the direct kill', async () => {
    // Measured on a real Windows runner: taskkill answers 128 when the pid is
    // gone and 1 when it may not touch it — both are non-zero, and both mean
    // the tree was NOT terminated.
    const h = harness(1);
    killProcessTree(4242, true, 'SIGKILL', h.deps);
    await h.settle();

    expect(h.killed).toEqual([{ pid: 4242, signal: 'SIGKILL' }]);
  });

  test('a taskkill that succeeded is not followed by a second kill', async () => {
    const h = harness(0);
    killProcessTree(4242, true, 'SIGKILL', h.deps);
    await h.settle();

    expect(h.killed).toEqual([]);
  });

  test('a taskkill that could not be started falls back, and never throws', async () => {
    const h = throwingHarness();
    expect(() => killProcessTree(4242, false, 'SIGTERM', h.deps)).not.toThrow();

    expect(h.killed).toEqual([{ pid: 4242, signal: 'SIGTERM' }]);
  });

  test('a failed fallback kill is swallowed, because this runs during shutdown', async () => {
    const deps: KillTreeDeps = {
      platform: 'win32',
      spawnTaskkill: () => ({ exited: Promise.resolve(1) }),
      kill: () => {
        throw new Error('EPERM');
      },
    };
    expect(() => killProcessTree(4242, false, 'SIGTERM', deps)).not.toThrow();
    // Two microtask drains: one for the rejection handler, one for the catch.
    await Promise.resolve();
    await Promise.resolve();
  });
});

describe('killProcessTree — shared guards', () => {
  test('no pid is a no-op, not an error', () => {
    const h = harness(0);
    expect(() => killProcessTree(undefined, true, 'SIGKILL', h.deps)).not.toThrow();
    expect(h.spawned).toEqual([]);
  });

  test('a pid of 0 is refused, so a missing pid cannot signal the whole group', () => {
    // `process.kill(-0)` is `process.kill(0)`: every process this one may
    // signal. A falsy pid reaching the POSIX branch would take the server down.
    const h = harness(0);
    expect(() => killProcessTree(0, true, 'SIGKILL', h.deps)).not.toThrow();
    expect(h.spawned).toEqual([]);
  });
});

describe('killProcessTree — POSIX', () => {
  test('a detached child is signalled through its group, and dies', async () => {
    const child = Bun.spawn({
      cmd: ['sleep', '30'],
      detached: true,
      stdout: 'ignore',
      stderr: 'ignore',
    });
    try {
      killProcessTree(child.pid, true, 'SIGKILL');
      // Awaiting the real exit is the assertion: bun's own per-test timeout
      // fails this if the group signal never landed.
      const code = await child.exited;
      expect(typeof code).toBe('number');
    } finally {
      try {
        process.kill(child.pid, 'SIGKILL');
      } catch {}
    }
  });

  test('a pid that is not a group leader still receives the direct signal', async () => {
    // `-pid` on a non-leader throws ESRCH, which is the branch the fallback
    // exists for. Asserting it does not throw is the whole contract: this is
    // called from a dying server.
    expect(() => killProcessTree(4_194_303, false, 'SIGTERM')).not.toThrow();
  });
});
