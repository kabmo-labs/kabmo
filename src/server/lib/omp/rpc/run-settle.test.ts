/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The settle path for a run omp no longer owns.
 *
 * A `stream` row is written at dispatch and released by a terminal `agent_end`.
 * A run whose turn ended non-terminally (`agent_end {isTerminal:false}`) and
 * whose continuation never came leaves the row `stream` with `isRunning()` still
 * true — and nothing reaches it: the row's owner is this LIVE process (so the
 * sidebar heal's staleness half says "alive" and its orphan half only releases
 * rows this process does NOT hold), while `GET /api/agent/:id` answers a busy
 * session from local flags so the one reconciler, `get_state`, is never called.
 * Measured on a real stranded child: the row survived 90s of sidebar loads.
 *
 * The repair is omp's own quiescence verdict. These cases pin both halves: it
 * fires only on `isSettled === true`, and it never touches a run that is still
 * talking, waiting on an announced retry, parked on a dialog, or running a
 * shell command.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeDir } from '@/test-support/remove-dir';

import { AgentSessionWrapper } from '@/server/lib/omp/rpc/manager';
import type { RpcProcess } from '@/server/lib/omp/rpc/process';
import { RunSettle, type RunSettleHost } from '@/server/lib/omp/rpc/run-settle.server';
import type { AgentEvent, RpcSessionState } from '@/server/lib/omp/rpc/constants';
import { loadStreamStates, markStreamStatus } from '@/shared/lib/omp/session/stream-state.server';

let root: string;
let savedDbPath: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ompchamber-settle-'));
  savedDbPath = Bun.env.OMPCHAMBER_DB_PATH;
  Bun.env.OMPCHAMBER_DB_PATH = join(root, 'db.sqlite');
  delete globalThis.__ompChamberDb;
});

afterEach(() => {
  // CLOSE the db handle before dropping it and deleting the tree, or Windows
  // fails the `rm` with EBUSY on the still-open connection.
  globalThis.__ompChamberDb?.resolved?.raw.close();
  delete globalThis.__ompChamberDb;
  if (savedDbPath === undefined) delete Bun.env.OMPCHAMBER_DB_PATH;
  else Bun.env.OMPCHAMBER_DB_PATH = savedDbPath;
  removeDir(root);
});

/** omp's answer for the probe, as the wrapper builds it from `get_state`. */
function sessionState(overrides: Partial<RpcSessionState> = {}): RpcSessionState {
  return {
    sessionId: 'sess-stale',
    sessionFile: '/tmp/s.jsonl',
    isStreaming: false,
    isSettled: true,
    isCompacting: false,
    autoCompactionEnabled: true,
    interruptMode: 'immediate',
    steeringMode: 'all',
    followUpMode: 'all',
    messageCount: 4,
    queuedMessageCount: 0,
    ...overrides,
  };
}

/** A host that claims a live run, with a proc whose `get_state` is scriptable. */
function makeHost(state: RpcSessionState | (() => Promise<RpcSessionState>)) {
  const sent: string[] = [];
  const emitted: AgentEvent[] = [];
  const host: RunSettleHost = {
    sessionId: 'sess-stale',
    streaming: true,
    promptRunning: true,
    compacting: false,
    bashRunning: false,
    awaitingAgentStart: false,
    awaitingAgentStartDeadline: 0,
    promptDispatchPendingCount: 0,
    continuationGraceUntil: 0,
    fastModeEnabled: false,
    restarting: false,
    proc: {
      isAlive: true,
      sendCommand(command: { type: string }) {
        sent.push(command.type);
        return typeof state === 'function' ? state() : Promise.resolve(state);
      },
    } as unknown as RpcProcess,
    isAlive: () => true,
    isRunning() {
      return this.streaming || this.promptRunning || this.compacting || this.bashRunning;
    },
    adoptSessionIdentity() {},
    getPendingUiDialogs: () => [],
    emit(event: AgentEvent) {
      emitted.push(event);
    },
  };
  return { host, sent, emitted };
}

const settle = (host: RunSettleHost, options?: { silenceMs?: number; retrySlackMs?: number }) =>
  new RunSettle(host, { silenceMs: 0, retrySlackMs: 0, ...options });

/** Let a fired timer's async probe (`get_state` → settle) run to completion
 *  under fake timers, without a wall-clock wait. */
async function flushMicrotasks(): Promise<void> {
  for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
}

describe('settling a run omp no longer owns', () => {
  test('omp says settled → the run is released and the clients get a terminal frame', async () => {
    const { host, sent, emitted } = makeHost(sessionState());
    expect(await settle(host).reconcile('request')).toBe(true);
    expect(sent).toEqual(['get_state']);
    expect(host.streaming).toBe(false);
    expect(host.promptRunning).toBe(false);
    expect(host.isRunning()).toBe(false);
    expect(emitted).toEqual([{ type: 'agent_end', isTerminal: true, messages: [] }]);
  });

  test('a live run is left exactly as it was — no flag is touched', async () => {
    const { host, emitted } = makeHost(sessionState({ isStreaming: true, isSettled: false }));
    expect(await settle(host).reconcile('request')).toBe(false);
    expect(host.streaming).toBe(true);
    expect(host.promptRunning).toBe(true);
    expect(emitted).toEqual([]);
  });

  test('a build that does not report isSettled is never settled on', async () => {
    const { host } = makeHost(sessionState({ isSettled: undefined }));
    expect(await settle(host).reconcile('request')).toBe(false);
    expect(host.streaming).toBe(true);
  });

  test('a run that is still talking is not even probed', async () => {
    const { host, sent } = makeHost(sessionState());
    const clock = new RunSettle(host, { silenceMs: 30_000, retrySlackMs: 0 });
    try {
      clock.noteFrame({ type: 'message_update' } as AgentEvent);
      expect(await clock.reconcile('request')).toBe(false);
      expect(sent).toEqual([]);
    } finally {
      // A clock that is not stopped leaves a live 30s timer, which keeps the
      // process (and the database handle it opened) alive past the test — and
      // on Windows that is what made the teardown delete fail with EBUSY.
      clock.stop();
    }
  });

  test('an announced retry wait is not probed inside, and is probed once it lands', async () => {
    const { host, sent } = makeHost(sessionState());
    const clock = settle(host, { retrySlackMs: 60_000 });
    clock.noteFrame({ type: 'auto_retry_start', attempt: 1, delayMs: 10_000 } as AgentEvent);
    expect(await clock.reconcile('request')).toBe(false);
    expect(sent).toEqual([]);
    // The retry's own agent_start clears the announced window.
    clock.noteFrame({ type: 'agent_start' } as AgentEvent);
    expect(await clock.reconcile('request')).toBe(true);
    expect(sent).toEqual(['get_state']);
  });

  test('a session parked on a dialog is left alone', async () => {
    const { host, sent } = makeHost(sessionState());
    host.getPendingUiDialogs = () => [{ id: 'ask-1' }];
    expect(await settle(host).reconcile('request')).toBe(false);
    expect(sent).toEqual([]);
  });

  test('a running shell command blocks the settle even when omp reports settled', async () => {
    const { host, emitted } = makeHost(sessionState());
    host.bashRunning = true;
    expect(await settle(host).reconcile('request')).toBe(false);
    expect(emitted).toEqual([]);
    expect(host.streaming).toBe(true);
  });

  test('a probe that cannot answer changes nothing and is retried', async () => {
    let attempts = 0;
    const { host } = makeHost(() => {
      attempts += 1;
      if (attempts === 1) return Promise.reject(new Error('get_state timed out'));
      return Promise.resolve(sessionState());
    });
    const clock = settle(host);
    expect(await clock.reconcile('request')).toBe(false);
    expect(host.streaming).toBe(true);
    expect(await clock.reconcile('request')).toBe(true);
    expect(host.streaming).toBe(false);
  });

  test('the clock settles on its own once the run has been quiet long enough', async () => {
    const { host, emitted } = makeHost(sessionState());
    vi.useFakeTimers();
    try {
      const clock = settle(host, { silenceMs: 10 });
      clock.noteFrame({ type: 'turn_start' } as AgentEvent);
      vi.advanceTimersByTime(50);
      await flushMicrotasks();
      expect(host.streaming).toBe(false);
      expect(emitted).toEqual([{ type: 'agent_end', isTerminal: true, messages: [] }]);
      clock.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  test('stop() cancels the clock', async () => {
    const { host, sent } = makeHost(sessionState());
    vi.useFakeTimers();
    try {
      const clock = settle(host, { silenceMs: 10 });
      clock.noteFrame({ type: 'turn_start' } as AgentEvent);
      clock.stop();
      vi.advanceTimersByTime(100);
      await flushMicrotasks();
      expect(sent).toEqual([]);
      expect(host.streaming).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test('a stranded subagent roster is retired on omp\'s quiescence verdict', async () => {
    // A subagent whose terminal frame was lost leaves a roster entry that makes
    // `isBusy()` true with no run in flight — the shape that made a FINISHED
    // session report `busy` to every client that opened it (and, through the
    // client's snapshot handler, drew a phantom generating indicator).
    const { host, sent } = makeHost(sessionState());
    let roster = 1;
    host.subagents = { liveCount: () => roster, clear: () => { roster = 0; } };
    host.streaming = false;
    host.promptRunning = false;

    expect(await settle(host).reconcile('request')).toBe(false);
    expect(sent).toEqual(['get_state']);
    expect(roster).toBe(0);
  });

  test('a non-quiescent verdict leaves the roster alone', async () => {
    const { host } = makeHost(sessionState({ isSettled: false }));
    let roster = 1;
    host.subagents = { liveCount: () => roster, clear: () => { roster = 0; } };
    host.streaming = false;
    host.promptRunning = false;

    expect(await settle(host).reconcile('request')).toBe(false);
    expect(roster).toBe(1);
  });

  test('the row behind a stranded run is released, not left at `stream`', async () => {
    const sessionId = 'sess-stranded';
    const proc = {
      isAlive: true,
      pid: 4242,
      onFrame: () => () => {},
      sendCommand: () => Promise.resolve(sessionState({ sessionId })),
      sendFrame() {},
      dispose: async () => {},
    } as unknown as RpcProcess;
    const wrapper = new AgentSessionWrapper(proc, '/tmp');
    wrapper.start();
    wrapper.adoptSessionIdentity({ sessionId, sessionFile: '/tmp/s.jsonl' } as never);
    wrapper.streaming = true;
    await markStreamStatus(sessionId, 'stream', { provider: 'deepseek', modelId: 'flash' });
    const events: AgentEvent[] = [];
    wrapper.onEvent((event) => events.push(event));

    // A short silence window: the wrapper's own clock uses the production 30s.
    const clock = new RunSettle(wrapper, { silenceMs: 0, retrySlackMs: 0 });
    try {
      expect(await clock.reconcile('request')).toBe(true);
    } finally {
      clock.stop();
    }
    expect((await loadStreamStates())[sessionId]?.status).toBe('finish');
    expect(wrapper.isRunning()).toBe(false);
    expect(events).toContainEqual({ type: 'agent_end', isTerminal: true, messages: [] });
  });
});
