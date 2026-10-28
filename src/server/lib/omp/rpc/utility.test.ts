/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The shared utility-process pool: per-cwd keying, serialization, idle-kill
 * arming and the recycle paths.
 *
 * These are the rules that decide whether a registry query reuses a warm child
 * or boots a new one, whether a `/reload-plugins` broadcast reaches the right
 * child, and whether `omp update` leaves a stale build answering the model list.
 * A wrong key here is a wrong answer to `get_available_models` (project-scoped
 * config read from the wrong workspace), so the keying is pinned explicitly.
 *
 * Every pooled entry is seeded with a FAKE child: `runUtilityCommand` only
 * spawns when the pool has no live child, so nothing here starts an `omp`
 * process. The spawn path itself is not exercised.
 */

import { afterEach, beforeEach, describe, expect, test, spyOn, vi } from 'bun:test';
import { homedir } from 'os';

import {
  disposeUtilityRpc,
  reloadUtilityProcesses,
  restartUtilityProcesses,
  runUtilityCommand,
} from '@/server/lib/omp/rpc/utility';
import { RELOAD_PLUGINS_TIMEOUT_MS } from '@/server/lib/omp/rpc/constants';
import type { RpcProcess } from '@/server/lib/omp/rpc/process';

const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;

interface Child {
  proc: RpcProcess;
  calls: { command: Record<string, unknown>; timeoutMs: number | undefined }[];
  disposeCount: () => number;
  respond: (handler: (command: Record<string, unknown>) => unknown) => void;
}

function makeChild(options: { alive?: boolean } = {}): Child {
  const calls: Child['calls'] = [];
  let disposals = 0;
  let handler: (command: Record<string, unknown>) => unknown = () => undefined;
  const child = {
    isAlive: options.alive ?? true,
    async sendCommand(command: Record<string, unknown>, timeoutMs?: number) {
      calls.push({ command, timeoutMs });
      return handler(command);
    },
    async dispose() {
      disposals += 1;
    },
  };
  return {
    proc: child as unknown as RpcProcess,
    calls,
    disposeCount: () => disposals,
    respond: (next) => {
      handler = next;
    },
  };
}

interface UtilityState {
  proc: RpcProcess | null;
  idleTimer: NodeJS.Timeout | null;
  queue: Promise<void>;
}

let pool: Map<string, UtilityState>;

beforeEach(() => {
  pool = new Map();
  globalThis.__ompUtilityRpcStates = pool as unknown as typeof globalThis.__ompUtilityRpcStates;
});

afterEach(() => {
  disposeUtilityRpc();
  delete globalThis.__ompUtilityRpcStates;
});

function seed(cwd: string, child: Child | null, queue: Promise<void> = Promise.resolve()): UtilityState {
  const state: UtilityState = { proc: child?.proc ?? null, idleTimer: null, queue };
  pool.set(cwd, state);
  return state;
}

describe('runUtilityCommand pooling', () => {
  test('a command runs on the pooled child for its cwd with the caller timeout', async () => {
    const child = makeChild();
    child.respond(() => ({ models: ['m'] }));
    seed('/work/a', child);
    expect<unknown>(await runUtilityCommand({ type: 'get_available_models' }, 1_234, '/work/a')).toEqual({ models: ['m'] });
    expect(child.calls).toEqual([{ command: { type: 'get_available_models' }, timeoutMs: 1_234 }]);
  });

  test('the default timeout and the default home cwd are used when omitted', async () => {
    const child = makeChild();
    seed(homedir(), child);
    await runUtilityCommand({ type: 'get_login_providers' });
    expect(child.calls).toEqual([{ command: { type: 'get_login_providers' }, timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS }]);
  });

  test('each cwd keeps its own child: one workspace never answers another', async () => {
    const home = makeChild();
    const work = makeChild();
    seed(homedir(), home);
    seed('/work/b', work);
    await runUtilityCommand({ type: 'get_available_models' }, 1_000, '/work/b');
    expect(work.calls.length).toBe(1);
    expect(home.calls.length).toBe(0);
    await runUtilityCommand({ type: 'get_available_models' }, 1_000, homedir());
    expect(home.calls.length).toBe(1);
    expect(pool.size).toBe(2);
  });

  test('a second command reuses the same live child', async () => {
    const child = makeChild();
    seed('/work/c', child);
    await runUtilityCommand({ type: 'get_available_models' }, 1_000, '/work/c');
    await runUtilityCommand({ type: 'get_login_providers' }, 1_000, '/work/c');
    expect(child.calls.map((call) => call.command.type)).toEqual(['get_available_models', 'get_login_providers']);
    expect(child.disposeCount()).toBe(0);
  });

  test('commands on one pool are serialized, not interleaved', async () => {
    const child = makeChild();
    const gate = Promise.withResolvers<unknown>();
    child.respond(() => gate.promise);
    seed('/work/d', child);
    const first = runUtilityCommand({ type: 'get_available_models' }, 1_000, '/work/d');
    const second = runUtilityCommand({ type: 'get_login_providers' }, 1_000, '/work/d');
    await Promise.resolve();
    // The second command must not have reached the child while the first is
    // still in flight: omp's RPC loop answers one command at a time anyway.
    expect(child.calls.length).toBe(1);
    gate.resolve({ ok: true });
    await first;
    await second;
    expect(child.calls.length).toBe(2);
  });

  test('a rejection never poisons the queue for later commands', async () => {
    const child = makeChild();
    child.respond(() => {
      throw new Error('boom');
    });
    seed('/work/e', child);
    await expect(runUtilityCommand({ type: 'get_available_models' }, 1_000, '/work/e')).rejects.toThrow('boom');
    child.respond(() => ({ ok: true }) as { ok: boolean });
    expect<unknown>(await runUtilityCommand({ type: 'get_available_models' }, 1_000, '/work/e')).toEqual({ ok: true });
    expect(child.calls.length).toBe(2);
  });

  test('an idle kill is armed after every command and cleared by the next', async () => {
    const child = makeChild();
    const state = seed('/work/f', child);
    expect(state.idleTimer).toBeNull();
    await runUtilityCommand({ type: 'get_available_models' }, 1_000, '/work/f');
    const armed = state.idleTimer;
    expect(armed).not.toBeNull();
    await runUtilityCommand({ type: 'get_available_models' }, 1_000, '/work/f');
    expect(state.idleTimer).not.toBe(armed);
  });
});

describe('reloadUtilityProcesses', () => {
  test('only a live child is asked to re-read its roots', async () => {
    const live = makeChild();
    const dead = makeChild({ alive: false });
    seed('/work/g', live);
    seed('/work/h', dead);
    await reloadUtilityProcesses();
    expect(live.calls).toEqual([{ command: { type: 'prompt', message: '/reload-plugins' }, timeoutMs: RELOAD_PLUGINS_TIMEOUT_MS }]);
    expect(dead.calls).toEqual([]);
  });

  test('is a no-op with no pooled processes', async () => {
    await expect(reloadUtilityProcesses()).resolves.toBeUndefined();
  });

  test('a failing child is reported, not rethrown', async () => {
    const failing = makeChild();
    failing.respond(() => {
      throw new Error('child gone');
    });
    seed('/work/i', failing);
    const logged = spyOn(console, 'error').mockImplementation(() => {});
    await reloadUtilityProcesses();
    // `mockRestore` drops the recorded calls, so the count is read first.
    const reports = logged.mock.calls.length;
    logged.mockRestore();
    expect(reports).toBe(1);
  });
});

describe('restartUtilityProcesses', () => {
  test('recycles only live children and counts them', async () => {
    const live = makeChild();
    seed('/work/j', live);
    seed('/work/k', null);
    expect(await restartUtilityProcesses()).toBe(1);
    expect(live.disposeCount()).toBe(1);
    // The pool entries stay: "no child" is a normal state, and the next command
    // lazily starts from the current binary.
    expect(pool.size).toBe(2);
    expect(pool.get('/work/j')?.proc).toBeNull();
  });

  test('an in-flight command finishes on its child before the recycle disposes it', async () => {
    const child = makeChild();
    const gate = Promise.withResolvers<void>();
    seed('/work/l', child, gate.promise);
    const restart = restartUtilityProcesses();
    await Promise.resolve();
    expect(child.disposeCount()).toBe(0);
    gate.resolve();
    expect(await restart).toBe(1);
    expect(child.disposeCount()).toBe(1);
  });

  test('is a no-op with no pooled processes', async () => {
    expect(await restartUtilityProcesses()).toBe(0);
  });
});

describe('disposeUtilityRpc', () => {
  test('disposes every pooled child, clears the idle timers and empties the pool', () => {
    vi.useFakeTimers();
    try {
      const first = makeChild();
      const second = makeChild();
      const firstState = seed('/work/m', first);
      const secondState = seed('/work/n', second);
      let fired = false;
      firstState.idleTimer = setTimeout(() => {
        fired = true;
      }, 1);
      secondState.idleTimer = setTimeout(() => {
        fired = true;
      }, 1);
      disposeUtilityRpc();
      expect(first.disposeCount()).toBe(1);
      expect(second.disposeCount()).toBe(1);
      expect(pool.size).toBe(0);
      expect(firstState.idleTimer).toBeNull();
      // The pending idle kills were cleared, not merely unref'd.
      vi.advanceTimersByTime(10);
      expect(fired).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test('is a no-op when no pool exists', () => {
    delete globalThis.__ompUtilityRpcStates;
    expect(() => disposeUtilityRpc()).not.toThrow();
  });
});
