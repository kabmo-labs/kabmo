/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
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
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dispatchSessionCommand } from '@/server/lib/omp/rpc/session-commands';
import { RpcCommandError, RpcCommandTimeoutError } from '@/server/lib/omp/rpc/process';
import { AGENT_BUSY_MESSAGE, AWAITING_AGENT_START_TIMEOUT_MS, RESTARTING_MESSAGE, SESSION_BUSY_MESSAGE, WebRpcError } from '@/server/lib/omp/rpc/constants';
import { cancelQueuedDelivery } from '@/server/lib/queue/delivery.server';
import { makeHarness, rejectionOf } from '@/server/lib/omp/rpc/session-commands-harness';
import { removeDir } from '@/test-support/remove-dir';

let root: string;
let savedDbPath: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kabmo-test-'));
  savedDbPath = Bun.env.KABMO_DB_PATH;
  // The stream-status writes resolve the database; point them at the temp tree
  // so the real `~/.kabmo` is never created or opened.
  Bun.env.KABMO_DB_PATH = join(root, 'db.sqlite');
  delete globalThis.__kabmoDb;
});

afterEach(() => {
  cancelQueuedDelivery('sess-1');
  delete globalThis.__kabmoDb;
  if (savedDbPath === undefined) delete Bun.env.KABMO_DB_PATH;
  else Bun.env.KABMO_DB_PATH = savedDbPath;
  removeDir(root);
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
    const h = makeHarness({ isBusy: () => true });
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

describe('argument mapping', () => {
  test('set_session_name trims and refuses a blank name', async () => {
    const h = makeHarness();
    expect(String(await rejectionOf(dispatchSessionCommand(h.host, { type: 'set_session_name', name: '   ' })))).toContain(
      'Session name cannot be empty',
    );
    expect(String(await rejectionOf(dispatchSessionCommand(h.host, { type: 'set_session_name' })))).toContain(
      'Session name cannot be empty',
    );
    expect(h.calls).toEqual([]);
    await dispatchSessionCommand(h.host, { type: 'set_session_name', name: '  My chat  ' });
    expect(h.calls).toEqual([{ type: 'set_session_name', name: 'My chat' }]);
  });

  test('set_model returns only the identity pair, and read/abort aliases map correctly', async () => {
    const h = makeHarness();
    h.respond(() => ({ id: 'm1', provider: 'p1', name: 'ignored', contextWindow: 1 }));
    expect(await dispatchSessionCommand(h.host, { type: 'set_model', provider: 'p1', modelId: 'm1' })).toEqual({
      id: 'm1',
      provider: 'p1',
    });
    // The ack's RESOLVED pair is what a later prompt dispatch persists on the
    // stream row for the generating indicator.
    expect(h.host.runModel).toEqual({ provider: 'p1', modelId: 'm1' });
    expect(await dispatchSessionCommand(h.host, { type: 'abort_compaction' })).toBeNull();
    h.respond(() => ({ commands: [{ name: 'x' }] }));
    expect(await dispatchSessionCommand(h.host, { type: 'get_commands' })).toEqual({ commands: [{ name: 'x' }] });
    expect(h.calls).toEqual([
      { type: 'set_model', provider: 'p1', modelId: 'm1' },
      { type: 'abort' },
      { type: 'get_available_commands' },
    ]);
  });

  test('set_fast_mode only treats the literal true as enabled', async () => {
    const h = makeHarness();
    h.respond(() => ({}));
    expect(await dispatchSessionCommand(h.host, { type: 'set_fast_mode', enabled: 'yes' })).toEqual({ enabled: false, active: false });
    h.respond(() => ({ enabled: true, active: true }));
    expect(await dispatchSessionCommand(h.host, { type: 'set_fast_mode', enabled: true })).toEqual({ enabled: true, active: true });
    expect(h.host.fastModeEnabled).toBe(true);
    expect(h.calls).toEqual([{ type: 'set_fast_mode', enabled: false }, { type: 'set_fast_mode', enabled: true }]);
  });

  test('compact forwards custom instructions only when present', async () => {
    const h = makeHarness();
    await dispatchSessionCommand(h.host, { type: 'compact' });
    await dispatchSessionCommand(h.host, { type: 'compact', customInstructions: 'keep the plan' });
    expect(h.calls).toEqual([{ type: 'compact' }, { type: 'compact', customInstructions: 'keep the plan' }]);
    expect(h.host.compacting).toBe(false);
  });

  test('bash refuses while the session is busy and clears the flag after', async () => {
    const h = makeHarness({ isRunning: () => true });
    expect(String(await rejectionOf(dispatchSessionCommand(h.host, { type: 'bash', command: 'ls' })))).toContain(
      'Cannot run a shell command while the session is busy',
    );
    const idle = makeHarness();
    await dispatchSessionCommand(idle.host, { type: 'bash', command: 'ls' });
    expect(idle.calls).toEqual([{ type: 'bash', command: 'ls' }]);
    expect(idle.host.bashRunning).toBe(false);
  });

  test('force_reset destroys the session without sending anything', async () => {
    const h = makeHarness();
    expect(await dispatchSessionCommand(h.host, { type: 'force_reset' })).toBeNull();
    expect(h.counters.destroys).toBe(1);
    expect(h.calls).toEqual([]);
  });
});

describe('extension_ui_response', () => {
  test('requires an id and otherwise writes a frame without awaiting a response', async () => {
    const h = makeHarness();
    expect(String(await rejectionOf(dispatchSessionCommand(h.host, { type: 'extension_ui_response', result: 'ok' })))).toContain(
      'extension_ui_response requires an id',
    );
    expect(await dispatchSessionCommand(h.host, { type: 'extension_ui_response', id: 'ui-1', result: 'ok' })).toBeNull();
    expect(h.calls).toEqual([]);
    expect(h.frames).toEqual([{ type: 'extension_ui_response', id: 'ui-1', result: 'ok' }]);
    expect(h.counters.resolvedDialogs).toEqual(['ui-1']);
  });
});

describe('passthrough', () => {
  test('the command is forwarded verbatim and an empty ack reads as null', async () => {
    const h = makeHarness();
    expect(await dispatchSessionCommand(h.host, { type: 'get_messages', limit: 5 })).toBeNull();
    expect(h.calls).toEqual([{ type: 'get_messages', limit: 5 }]);
  });

  test('the ack payload is returned unchanged', async () => {
    const h = makeHarness();
    h.respond(() => ({ messages: ['a'] }));
    expect(await dispatchSessionCommand(h.host, { type: 'get_messages_page' })).toEqual({ messages: ['a'] });
  });
});
