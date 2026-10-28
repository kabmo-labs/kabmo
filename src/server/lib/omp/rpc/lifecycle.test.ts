/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The wrapper's lifecycle rules: which conditions may reclaim a session's omp
 * process. A reset kills the whole process group, so a wrong answer here
 * destroys a live turn and every subagent under it.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'bun:test';

import { AgentSessionWrapper, WebRpcError } from '@/server/lib/omp/rpc/manager';
import { RpcCommandTimeoutError, type RpcProcess } from '@/server/lib/omp/rpc/process';

/** Commands whose ack is fabricated as timed out; everything else resolves, so
 *  only the timeout policy is under test. */
const TIMED_OUT_COMMANDS: Record<string, true> = { get_state: true, prompt: true };

interface StubProcess {
  proc: RpcProcess;
  emit(frame: Record<string, unknown>): void;
  disposeCount(): number;
}

function makeProc(): StubProcess {
  let listener: ((frame: unknown) => void) | null = null;
  let disposals = 0;
  const proc = {
    isAlive: true,
    pid: 4242,
    onFrame(next: (frame: unknown) => void) {
      listener = next;
      return () => {
        listener = null;
      };
    },
    sendCommand(command: { type: string }) {
      if (TIMED_OUT_COMMANDS[command.type] === true) {
        return Promise.reject(new RpcCommandTimeoutError(command.type, 1));
      }
      return Promise.resolve(undefined);
    },
    sendFrame() {},
    async dispose() {
      disposals += 1;
    },
  };
  return {
    proc: proc as unknown as RpcProcess,
    emit: (frame) => listener?.(frame),
    disposeCount: () => disposals,
  };
}

async function rejectionOf(operation: Promise<unknown>): Promise<WebRpcError> {
  const error = await operation.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(WebRpcError);
  return error as WebRpcError;
}

/** A process that completes the readiness handshake, so `waitUntilReady`
 *  reaches the `get_state` probe whose message count seeds the title latch. */
function makeReadyProc(messageCount: number): RpcProcess {
  const proc = {
    isAlive: true,
    pid: 4243,
    onFrame() {
      return () => {};
    },
    waitReady() {
      return Promise.resolve({ type: 'ready' });
    },
    negotiateProtocol() {
      return Promise.resolve(1);
    },
    sendCommand(command: { type: string }) {
      if (command.type === 'get_state') {
        return Promise.resolve({ sessionId: 'sess-1', sessionFile: '/tmp/s.jsonl', messageCount, isStreaming: false, isCompacting: false });
      }
      return Promise.resolve(undefined);
    },
    sendFrame() {},
    async dispose() {},
  };
  return proc as unknown as RpcProcess;
}

describe('AgentSessionWrapper lifecycle', () => {
  // Every command arms the wrapper's idle timer; keep the clock fake so a test
  // never schedules a real ten-minute window.
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('resets a session that ignores commands while idle', async () => {
    const stub = makeProc();
    const wrapper = new AgentSessionWrapper(stub.proc, '/tmp');

    const error = await rejectionOf(wrapper.send({ type: 'get_state' }));

    expect(error.code).toBe('session_unresponsive');
    expect(stub.disposeCount()).toBe(1);
  });

  test('keeps the process when a get_state times out mid-turn', async () => {
    const stub = makeProc();
    const wrapper = new AgentSessionWrapper(stub.proc, '/tmp');
    wrapper.start();
    stub.emit({ type: 'agent_start' });

    const error = await rejectionOf(wrapper.send({ type: 'get_state' }));

    expect(error.code).toBe('session_busy');
    expect(stub.disposeCount()).toBe(0);
    expect(wrapper.isRunning()).toBe(true);
  });

  test('keeps the process when a prompt ack times out mid-turn', async () => {
    const stub = makeProc();
    const wrapper = new AgentSessionWrapper(stub.proc, '/tmp');
    wrapper.start();
    stub.emit({ type: 'agent_start' });

    const error = await rejectionOf(wrapper.send({ type: 'prompt', message: 'hi' }));

    expect(error.code).toBe('session_busy');
    expect(stub.disposeCount()).toBe(0);
  });

  test('idle reclaim waits for subagents that outlive the turn', () => {
    const stub = makeProc();
    const wrapper = new AgentSessionWrapper(stub.proc, '/tmp', null, { idleDestroyMs: 20 });
    wrapper.start();

    stub.emit({ type: 'agent_start' });
    stub.emit({ type: 'agent_end', isTerminal: true });
    stub.emit({ type: 'subagent_lifecycle', payload: { id: 's1', status: 'started', index: 0 } });
    expect(wrapper.isRunning()).toBe(false);
    expect(wrapper.isBusy()).toBe(true);

    vi.advanceTimersByTime(200);
    expect(stub.disposeCount()).toBe(0);

    stub.emit({ type: 'subagent_lifecycle', payload: { id: 's1', status: 'completed', index: 0 } });
    expect(wrapper.isBusy()).toBe(false);

    vi.advanceTimersByTime(200);
    expect(stub.disposeCount()).toBe(1);
  });

  test('force_reset reclaims a process whose turn will not stop', async () => {
    const stub = makeProc();
    const wrapper = new AgentSessionWrapper(stub.proc, '/tmp');
    stub.emit({ type: 'agent_start' });

    await wrapper.send({ type: 'force_reset' });

    expect(stub.disposeCount()).toBe(1);
  });

  test('a fresh conversation is title-eligible, a resumed one is not', async () => {
    // omp reports the messages it restored, so `messageCount` is the only
    // signal that separates "this session has no first turn yet" from "this
    // child resumed a conversation that already has one". Getting it wrong
    // re-titles an existing session from its newest turn.
    const fresh = new AgentSessionWrapper(makeReadyProc(0), '/tmp');
    await fresh.waitUntilReady();
    expect(fresh.autoTitlePending).toBe(true);

    const resumed = new AgentSessionWrapper(makeReadyProc(2), '/tmp');
    await resumed.waitUntilReady();
    expect(resumed.autoTitlePending).toBe(false);
  });
});

/**
 * The deadline watchdog. Nothing else watches `awaitingAgentStartDeadline`, and
 * a dispatch whose turn never opens strands the session: `promptRunning` stays
 * true, so the idle reaper refuses to reclaim the child and the agent-state
 * route reports `busy` forever, while the `stream` row (owner ALIVE) is beyond
 * the reach of the sidebar heal.
 *
 * Driven through the real wrapper, so the host wiring is covered too. The row
 * clear goes through `clearStreamStatus`, which resolves `getDb()` — and a test
 * must never open the developer's database — so that half is asserted
 * end to end against a real omp child on a temp database instead.
 */
describe('AgentSessionWrapper agent-start watchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A wrapper mid-dispatch: a prompt was sent and its turn has not opened.
   *  Returns the frame stub too, so a test can drive the real frame path. */
  function dispatched(): { wrapper: AgentSessionWrapper; emit: (frame: Record<string, unknown>) => void } {
    const stub = makeProc();
    const wrapper = new AgentSessionWrapper(stub.proc, '/tmp');
    // The id is getter-only; `adoptSessionIdentity` is how a real child sets it.
    wrapper.adoptSessionIdentity({ sessionId: 'sess-1', sessionFile: '/tmp/s.jsonl' } as never);
    wrapper.promptRunning = true;
    wrapper.awaitingAgentStart = true;
    wrapper.awaitingAgentStartDeadline = Date.now() + 10_000;
    return { wrapper, emit: stub.emit };
  }

  test('settles a dispatch whose turn never opened', () => {
    const { wrapper } = dispatched();
    expect(wrapper.isRunning()).toBe(true);

    wrapper.armAgentStartWatchdog();
    vi.advanceTimersByTime(10_001);

    // The two things that were stuck: the run flag (and with it `isRunning()`,
    // the idle reaper's gate and the agent-state route's `busy`) and the
    // awaiting flag.
    expect(wrapper.awaitingAgentStart).toBe(false);
    expect(wrapper.promptRunning).toBe(false);
    expect(wrapper.awaitingAgentStartDeadline).toBe(0);
    expect(wrapper.isRunning()).toBe(false);
  });

  test('a turn that starts in time leaves the watchdog a no-op', () => {
    const { wrapper, emit } = dispatched();
    wrapper.start();
    wrapper.armAgentStartWatchdog();

    // The real settle, through the real frame path.
    emit({ type: 'agent_start' });
    expect(wrapper.streaming).toBe(true);

    vi.advanceTimersByTime(10_001);

    expect(wrapper.streaming).toBe(true);
    expect(wrapper.promptRunning).toBe(true);
  });

  test('a running turn is never settled by a late deadline', () => {
    // The belt to the braces above: even if the timer survives to its fire
    // time, the live flags win. Clearing here would blank a working spinner.
    const { wrapper } = dispatched();
    wrapper.armAgentStartWatchdog();
    wrapper.streaming = true;

    vi.advanceTimersByTime(10_001);

    expect(wrapper.promptRunning).toBe(true);
    expect(wrapper.awaitingAgentStart).toBe(true);
  });

  test('a settled frame cancels the timer instead of letting it fire', () => {
    const { wrapper, emit } = dispatched();
    wrapper.start();
    wrapper.armAgentStartWatchdog();

    emit({ type: 'agent_start' });
    // Re-arm the deadline by hand: the timer was cancelled on that frame, so it
    // must not fire even though a deadline is set again.
    wrapper.awaitingAgentStartDeadline = Date.now() + 10_000;
    vi.advanceTimersByTime(10_001);

    expect(wrapper.awaitingAgentStart).toBe(false);
  });

  test('re-arming replaces the previous timer instead of double-firing', () => {
    const { wrapper } = dispatched();
    wrapper.armAgentStartWatchdog();
    // A second dispatch re-arms on the same wrapper.
    wrapper.awaitingAgentStartDeadline = Date.now() + 20_000;
    wrapper.armAgentStartWatchdog();

    // Past the FIRST deadline: the replaced timer must not have fired.
    vi.advanceTimersByTime(10_001);
    expect(wrapper.awaitingAgentStart).toBe(true);

    vi.advanceTimersByTime(10_000);
    expect(wrapper.awaitingAgentStart).toBe(false);
  });

  test('arming with nothing pending schedules nothing', () => {
    const wrapper = new AgentSessionWrapper(makeProc().proc, '/tmp');
    wrapper.armAgentStartWatchdog();
    vi.advanceTimersByTime(60_000);
    expect(wrapper.promptRunning).toBe(false);
  });
});
