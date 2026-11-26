/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The session command dispatcher: how a client command becomes an RPC command.
 *
 * Every case here is a place where a wrong mapping is a user-visible lie — a
 * prompt that reaches the model as literal text (`/hotkeys`), an abort that
 * arrives as something else, an image payload that bypasses the size bound. The
 * timeout policy is included because it decides whether a wedged child is
 * destroyed or a live turn is thrown away with its subagents. The host and the
 * process are fakes; no omp child is spawned.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { dispatchSessionCommand } from '@/server/lib/omp/rpc/session-commands';
import { foldSessionFrame } from '@/server/lib/omp/rpc/frame-fold';
import type { SessionFrameHost } from '@/server/lib/omp/rpc/frame-fold-contract';
import type { AgentEvent } from '@kabmo-labs/kabmo-omp-rpc-protocol/constants';
import { RpcCommandError, RpcCommandTimeoutError } from '@kabmo-labs/kabmo-omp-rpc-process/process';
import { AGENT_BUSY_MESSAGE, AWAITING_AGENT_START_TIMEOUT_MS, RESTARTING_MESSAGE, SESSION_BUSY_MESSAGE, WebRpcError } from '@kabmo-labs/kabmo-omp-rpc-protocol/constants';
import { cancelQueuedDelivery } from '@/server/lib/queue/delivery.server';
import { makeHarness, rejectionOf } from '@/server/lib/omp/rpc/session-commands-harness';
import { getDb } from '@/server/db.server';
import { loadStreamStates } from '@kabmo-labs/kabmo-session-stream-state';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';

/**
 * Isolated through the shared helper, not by hand.
 *
 * The stream-status writes resolve the database, so every case runs against a
 * temp tree and the real `~/.kabmo` is never opened. Clearing
 * `globalThis.__kabmoDb` is NOT a teardown: it drops the reference while the
 * SQLite handle stays open, and Windows then refuses to delete the temp tree —
 * measured on the Release gate as `EBUSY … a handle outlived its test` after the
 * full 5 s retry window, reported against the case that had just opened the
 * database. `releaseDb` closes the handle before deleting.
 */
beforeEach(async () => {
  await isolateDb();
});

afterEach(async () => {
  cancelQueuedDelivery('sess-1');
  await releaseDb();
});

describe('guards before dispatch', () => {
  test('a restarting session refuses every command without touching the child', async () => {
    const h = makeHarness({ restarting: true });
    const error = await rejectionOf(dispatchSessionCommand(h.host, { type: 'abort' }));
    expect(error).toBeInstanceOf(WebRpcError);
    expect((error as WebRpcError).message).toBe(RESTARTING_MESSAGE);
    expect((error as WebRpcError).code).toBe('session_restarting');
    expect(h.calls).toEqual([]);
    expect(h.counters.idleResets).toBe(0);
  });

  test('a dead session is refused before the switch', async () => {
    const h = makeHarness({ isAlive: () => false });
    expect(String(await rejectionOf(dispatchSessionCommand(h.host, { type: 'get_state' })))).toContain(
      'Session is no longer running',
    );
    expect(h.calls).toEqual([]);
  });

  test('image validation runs for every image-bearing command, even a passthrough one', async () => {
    const h = makeHarness();
    const images = Array.from({ length: 21 }, () => ({ data: 'AAAA', mimeType: 'image/png' }));
    for (const type of ['prompt', 'steer', 'abort_and_prompt']) {
      const error = await rejectionOf(dispatchSessionCommand(h.host, { type, message: 'hi', images }));
      expect(String(error)).toContain('Maximum of 20 attached images reached.');
    }
    expect(h.calls).toEqual([]);
  });

  test('an unknown command is refused by name', async () => {
    const h = makeHarness();
    expect(String(await rejectionOf(dispatchSessionCommand(h.host, { type: 'nope' })))).toContain('Unsupported command: nope');
  });
});

describe('prompt', () => {
  test('a prompt waits for the rename a finished run asked for', async () => {
    // Both are separate frames on one stdin. Without the barrier the prompt can
    // be admitted first, and the rename then names a conversation that has
    // already moved on — measured on a real session as a title derived from the
    // second prompt instead of the first run.
    const { promise: dispatchAck, resolve: ack } = Promise.withResolvers<void>();
    const h = makeHarness({ autoTitleDispatch: dispatchAck });
    h.respond(() => ({ agentInvoked: true }));

    let admitted = false;
    const prompt = dispatchSessionCommand(h.host, { type: 'prompt', message: 'second' }).then(() => {
      admitted = true;
    });
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    // The rename is still on its way to the child, so the prompt must not have
    // reached it.
    expect(admitted).toBe(false);
    expect(h.calls).toEqual([]);

    ack();
    await prompt;
    expect(h.calls).toEqual([{ type: 'prompt', message: 'second' }]);
  });

  test('the accepted ack arms the agent-start watchdog instead of clearing the turn', async () => {
    const h = makeHarness();
    h.respond(() => ({ agentInvoked: true }));
    const before = Date.now();
    expect(await dispatchSessionCommand(h.host, { type: 'prompt', message: 'hello' })).toBeNull();
    expect(h.calls).toEqual([{ type: 'prompt', message: 'hello' }]);
    expect(h.host.promptRunning).toBe(true);
    expect(h.host.awaitingAgentStart).toBe(true);
    expect(h.counters.watchdogs).toBe(1);
    expect(h.host.awaitingAgentStartDeadline).toBeGreaterThanOrEqual(before + AWAITING_AGENT_START_TIMEOUT_MS);
    expect(h.host.awaitingAgentStartDeadline).toBeLessThanOrEqual(Date.now() + AWAITING_AGENT_START_TIMEOUT_MS);
    expect(h.counters.idleResets).toBe(1);
  });

  test('an ack that invoked no agent settles the turn and reports it', async () => {
    const h = makeHarness({ promptRunning: true });
    h.respond(() => ({ agentInvoked: false }));
    await dispatchSessionCommand(h.host, { type: 'prompt', message: 'hello' });
    expect(h.host.promptRunning).toBe(false);
    expect(h.host.awaitingAgentStart).toBe(false);
    expect(h.counters.watchdogs).toBe(0);
    expect(h.events).toEqual([{ type: 'prompt_result', agentInvoked: false }]);
  });

  /**
   * A slash command may not claim the turn slot.
   *
   * Real omp 18.22.2 answers an EXTENSION command (`/kabmo-mode plan
   * republish`) with a BARE ack and a later `prompt_result
   * {agentInvoked:false}` — measured on a real child. The optimistic claim read
   * that bare ack as an admitted turn: it wrote a `stream` row and held
   * `promptRunning` until the 10 s agent-start watchdog, while the frame that
   * proved no turn opened was suppressed by the run-attribution rule. The
   * sidebar spinner and the docked indicator therefore kept turning over a
   * session that had already finished — reproduced by merely OPENING a settled
   * session, because `usePlanReview` dispatches that republish on mount.
   */
  test('a slash command with a bare ack claims nothing and writes no stream row', async () => {
    const h = makeHarness();
    // The status writes resolve the database; open it first so the assertion
    // below reads a settled handle rather than racing the first open.
    await getDb();
    h.respond(() => ({}));
    expect(await dispatchSessionCommand(h.host, { type: 'prompt', message: '/kabmo-mode plan republish' })).toBeNull();
    expect(h.host.promptRunning).toBe(false);
    expect(h.host.awaitingAgentStart).toBe(false);
    expect(h.counters.watchdogs).toBe(0);
    expect(h.events).toEqual([]);
    // The row is fire-and-forget; flush it so a write that DID happen would be
    // visible here.
    for (let turn = 0; turn < 40; turn += 1) await Promise.resolve();
    expect(await loadStreamStates()).toEqual({});
  });

  test('a local builtin settles the client without writing a stream row', async () => {
    const h = makeHarness();
    await getDb();
    // `/usage` is a LOCAL builtin: omp acks `agentInvoked:false` and sends no
    // `prompt_result`, so this branch is the only settle path.
    h.respond(() => ({ agentInvoked: false }));
    await dispatchSessionCommand(h.host, { type: 'prompt', message: '/usage' });
    expect(h.host.promptRunning).toBe(false);
    expect(h.counters.watchdogs).toBe(0);
    expect(h.events).toEqual([{ type: 'prompt_result', agentInvoked: false }]);
    for (let turn = 0; turn < 40; turn += 1) await Promise.resolve();
    expect(await loadStreamStates()).toEqual({});
  });

  test('a PLAIN prompt still claims the slot on a bare ack', async () => {
    // The claim exists for this case: a real turn acks bare and only announces
    // itself at `agent_start`, and the window between them is where the sidebar
    // must already show a spinner.
    const h = makeHarness();
    h.respond(() => ({}));
    await dispatchSessionCommand(h.host, { type: 'prompt', message: 'hello' });
    expect(h.host.promptRunning).toBe(true);
    expect(h.host.awaitingAgentStart).toBe(true);
    expect(h.counters.watchdogs).toBe(1);
  });

  test('the prompt_result that follows a bare-acked command reaches the client', async () => {
    // The composition is the bug: the dispatch must not claim the slot, or the
    // fold suppresses the very frame that proves no turn opened. With the claim
    // in place this frame was swallowed and the row stayed `stream` until the
    // 10 s watchdog — the spinner over a finished session.
    const h = makeHarness();
    h.respond(() => ({}));
    await dispatchSessionCommand(h.host, { type: 'prompt', message: '/kabmo-mode plan republish' });
    const { suppressForward } = foldSessionFrame(
      h.host as unknown as SessionFrameHost,
      { type: 'prompt_result', agentInvoked: false } as AgentEvent,
    );
    // The manager forwards a frame the fold did not suppress; the fold itself
    // only decides. `true` here is the bug: the client never learns the prompt
    // opened no turn.
    expect(suppressForward).toBe(false);
  });

  test('a streamingBehavior prompt does not claim the turn flags', async () => {
    const h = makeHarness();
    h.respond(() => ({ agentInvoked: true }));
    await dispatchSessionCommand(h.host, { type: 'prompt', message: 'hello', streamingBehavior: 'followUp' });
    expect(h.calls).toEqual([{ type: 'prompt', message: 'hello', streamingBehavior: 'followUp' }]);
    expect(h.host.promptRunning).toBe(false);
    expect(h.counters.watchdogs).toBe(0);
  });

  test('images ride along only when the list is non-empty', async () => {
    const h = makeHarness();
    const images = [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }];
    await dispatchSessionCommand(h.host, { type: 'prompt', message: 'a', images: [] });
    await dispatchSessionCommand(h.host, { type: 'prompt', message: 'b', images });
    expect(h.calls).toEqual([
      { type: 'prompt', message: 'a' },
      { type: 'prompt', message: 'b', images },
    ]);
  });

  test('a prompt during a shell command is refused', async () => {
    const h = makeHarness({ bashRunning: true });
    expect(String(await rejectionOf(dispatchSessionCommand(h.host, { type: 'prompt', message: 'hi' })))).toContain(
      'Cannot send a prompt while a shell command is running',
    );
    expect(h.calls).toEqual([]);
  });

  test('a TUI-only slash command is refused locally and answered like a real command', async () => {
    const h = makeHarness({ promptRunning: true });
    expect(await dispatchSessionCommand(h.host, { type: 'prompt', message: '/hotkeys' })).toBeNull();
    expect(h.calls).toEqual([]);
    expect(h.host.promptRunning).toBe(false);
    expect(h.events.length).toBe(2);
    expect(h.events[0].type).toBe('command_output');
    expect(h.events[1]).toEqual({ type: 'prompt_result', agentInvoked: false });
  });

  test('the same refusal as a steer leaves the running turn alone', async () => {
    const h = makeHarness({ promptRunning: true, isRunning: () => true });
    expect(await dispatchSessionCommand(h.host, { type: 'prompt', message: '/hotkeys', streamingBehavior: 'steer' })).toBeNull();
    expect(h.calls).toEqual([]);
    // Only the notice — the flags and the optimistic ack belong to the turn
    // the steer was aimed at.
    expect(h.events.map((event) => event.type)).toEqual(['command_output']);
    expect(h.host.promptRunning).toBe(true);
  });

  test('a busy session refuses a retry, and omp\'s own mid-turn refusal is the typed `agent_busy`', async () => {
    let settleArms = 0;
    const h = makeHarness({ isBusy: () => true, runSettle: { arm: () => { settleArms += 1; } } });
    h.respond(() => {
      throw new RpcCommandTimeoutError('prompt', 1);
    });
    const error = await rejectionOf(dispatchSessionCommand(h.host, { type: 'prompt', message: 'hi' }));
    expect((error as WebRpcError).code).toBe('session_busy');
    expect((error as WebRpcError).message).toBe(SESSION_BUSY_MESSAGE);
    expect(h.counters.destroys).toBe(0);
    expect(h.host.promptRunning).toBe(false);
    h.respond(() => { throw new RpcCommandError('prompt', 'Agent is already processing.'); });
    const busy = await rejectionOf(dispatchSessionCommand(h.host, { type: 'prompt', message: 'hi' })) as WebRpcError;
    expect([busy.code, busy.message]).toEqual(['agent_busy', AGENT_BUSY_MESSAGE]);
    // The refusal is proof of a live turn, and the wrapper must keep it: the
    // queue's delivery gate and the sidebar both read these flags, so clearing
    // them here is what let a session dispatch at a busy child on every retry.
    expect(h.host.streaming).toBe(true);
    // ...and the settle clock must be able to retire that flag if the run's
    // terminal frame never arrives.
    expect(settleArms).toBe(1);
  });

  test('a command dispatched during a run\'s ack window does not settle the run', async () => {
    // The chamber's own `/chamber-mode` commands (the plan-review `republish`, a
    // mode toggle) are prompts too, and answer `agentInvoked:false`. Dispatched
    // while an earlier prompt is still in its ack round trip, they used to read
    // `streaming === false`, claim the turn slot, and release the RUNNING turn's
    // `stream` row + emit `prompt_result` — which the client folds as "the run
    // ended", blanking the generating indicator mid-answer.
    const h = makeHarness({ promptRunning: true, isRunning: () => true });
    h.respond(() => ({ agentInvoked: false }));
    expect(await dispatchSessionCommand(h.host, { type: 'prompt', message: '/chamber-mode plan republish' })).toBeNull();
    expect(h.host.promptRunning).toBe(true);
    expect(h.events).toEqual([]);
  });

  test('a timeout against an idle session resets the child', async () => {
    const h = makeHarness();
    h.respond(() => {
      throw new RpcCommandTimeoutError('prompt', 1);
    });
    const error = await rejectionOf(dispatchSessionCommand(h.host, { type: 'prompt', message: 'hi' }));
    expect((error as WebRpcError).code).toBe('session_unresponsive');
    expect(h.counters.destroys).toBe(1);
  });
});

