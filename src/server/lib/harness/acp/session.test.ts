/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One ACP turn, end to end: the ACK, the terminal frame, and what a Stop does to
 * the NEXT prompt.
 *
 * The session mounts itself through `session.test-util.ts`; the stubs and the
 * reasons for `session/prompt` being chained live there.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { mountSession, notify } from '@/server/lib/harness/acp/session.test-util';
import type { AcpConfigOption } from '@/server/lib/harness/acp/protocol';

// A prompt reaches the title writer (`harness/session-title.server.ts`), which
// opens the database. Isolate it: the handle is process-wide, and a suite that
// opens it reads and writes the developer's real `~/.kabmo/db.sqlite`.
beforeEach(async () => {
  await isolateDb();
});

afterEach(async () => {
  await releaseDb();
});

describe('ACP prompt dispatch', () => {
  test('answers an ACK immediately, not the turn', async () => {
    const { session, events, turn } = mountSession();
    const ack = await session.send({ type: 'prompt', message: 'hello' });
    // The turn promise is still open here — that is the point of the case.
    expect(ack).toEqual({ agentInvoked: true });
    expect(events.map((event) => event.type)).toContain('agent_start');
    turn.finish({ stopReason: 'end_turn' });
  });

  test('the turn end arrives as the terminal frame once the agent is done', async () => {
    const { session, events, turn } = mountSession();
    await session.send({ type: 'prompt', message: 'hello' });
    await turn.started;
    expect(events.some((event) => event.type === 'agent_end')).toBe(false);

    turn.finish({ stopReason: 'end_turn' });
    for (let i = 0; i < 4; i += 1) await Promise.resolve();

    expect(events.find((event) => event.type === 'agent_end')).toMatchObject({
      type: 'agent_end',
      isTerminal: true,
    });
    expect(session.isPromptRunning).toBe(false);
  });

  test('a failed turn reports its error once, and still closes the turn', async () => {
    const { session, events, turn } = mountSession();
    await session.send({ type: 'prompt', message: 'hello' });
    await turn.started;
    turn.fail(new Error('agent exploded'));
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    const errors = events.filter((event) => event.type === 'prompt_error');
    // The generic "no answer" verdict must not land on top of the agent's own
    // reason: it was emitted SECOND, so the client kept the useless one.
    expect(errors).toEqual([{ type: 'prompt_error', errorMessage: 'agent exploded' }]);
    expect(session.isPromptRunning).toBe(false);
  });

  test('the turn end arms the follow-up queue, exactly once', async () => {
    const { session, turn, turnEnds } = mountSession();
    await session.send({ type: 'prompt', message: 'hello' });
    await turn.started;
    // Nothing has ended yet: the queue must not be offered a slot while the
    // turn is still running, or the delivery tick would claim the head and
    // dispatch it over the turn the user is watching.
    expect(turnEnds()).toBe(0);

    turn.finish({ stopReason: 'end_turn' });
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    expect(turnEnds()).toBe(1);
  });
});

describe('ACP cancel', () => {
  test('closes the turn at once, so the next prompt is accepted', async () => {
    const { session, turn } = mountSession();
    let cancelled = 0;
    (session as unknown as { proc: Record<string, unknown> }).proc.cancel = () => {
      cancelled += 1;
    };
    await session.send({ type: 'prompt', message: 'long job' });
    session.cancelTurn();

    // The cancel is a NOTIFICATION: nothing guarantees the agent answers it. The
    // reported symptom was a spinner that cleared while `isStreaming` stayed up,
    // so the next send was refused with "Agent is already processing".
    expect(cancelled).toBe(1);
    expect(session.isPromptRunning).toBe(false);
    expect(session.isStreaming).toBe(false);
    expect(session.isRunning()).toBe(false);

    // The agent's own reply to the cancel arrives late; it must not close a turn
    // that is already closed.
    turn.finish({ stopReason: 'cancelled' });
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    expect(session.isRunning()).toBe(false);
  });

  test('the cancel reports the turn as cancelled, once', async () => {
    const { session, events, turn, turnEnds } = mountSession();
    (session as unknown as { proc: Record<string, unknown> }).proc.cancel = () => {};
    await session.send({ type: 'prompt', message: 'long job' });
    session.cancelTurn();
    turn.finish({ stopReason: 'cancelled' });
    for (let i = 0; i < 4; i += 1) await Promise.resolve();

    const ends = events.filter((event) => event.type === 'agent_end');
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ type: 'agent_end', isTerminal: true, cancelled: true });
    // A Stop ends the turn, so the queue it was holding must be offered a slot
    // rather than left waiting for the next user prompt.
    expect(turnEnds()).toBe(1);
  });
});

describe('ACP turn serialization', () => {
  test('a prompt sent after Stop is dispatched at once, because the cancel settled the one open', async () => {
    const { session, turn } = mountSession();
    await session.send({ type: 'prompt', message: 'long job' });
    await turn.started;
    session.cancelTurn();

    // `session/cancel` is a notification and omp never answers it: the request
    // stayed open for the life of the process, so the next turn — chained behind
    // it — never went out and every later send was refused as "already
    // processing". Settling it locally is what frees the chain.
    await session.send({ type: 'prompt', message: 'second' });
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    expect(turn.calls()).toBe(2);
    expect(session.isRunning()).toBe(true);
  });

  test('the cancelled turn reports one terminal frame, and nothing after it', async () => {
    const { session, events, turn } = mountSession();
    await session.send({ type: 'prompt', message: 'long job' });
    await turn.started;
    session.cancelTurn();

    const ends = events.filter((event) => event.type === 'agent_end');
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ type: 'agent_end', isTerminal: true, cancelled: true });

    // The agent keeps talking after the cancel; nobody is watching that turn, and
    // forwarding it reopened the assistant message the client had finalized.
    const before = events.length;
    (session as unknown as { onNotification: (m: string, p: unknown) => void }).onNotification('session/update', {
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'abandoned' } },
    });
    expect(events.length).toBe(before);
  });

  test('the replacement turn closes once, when its own prompt answers', async () => {
    const { session, events, turn } = mountSession();
    await session.send({ type: 'prompt', message: 'long job' });
    await turn.started;
    session.cancelTurn();
    await session.send({ type: 'prompt', message: 'second' });
    for (let i = 0; i < 8; i += 1) await Promise.resolve();

    turn.finish({ stopReason: 'end_turn' });
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    expect(events.filter((event) => event.type === 'agent_end')).toHaveLength(2);
    expect(session.isRunning()).toBe(false);
  });
});

const modelOption = (currentValue: string, values: string[]): AcpConfigOption => ({
  id: 'sel-model',
  category: 'model',
  type: 'select',
  currentValue,
  options: values.map((value) => ({ value })),
});

/**
 * The footer and the sidebar name a chat by the model the live session is
 * serving. An ACP model pick is a config write, not a respawn, so the identity
 * has to travel three ways: the session's own `runModel`, a frame the client
 * re-reads, and the model fields on the message itself.
 */
describe('ACP model identity', () => {
  test('set_model without a reply list still renames the session and announces it', async () => {
    const { session, events } = mountSession();
    session.configOptions = [modelOption('p/old', ['p/old', 'p/new'])];
    session.runModel = { provider: 'p', modelId: 'old' };

    await session.send({ type: 'set_model', provider: 'p', modelId: 'new' });

    expect(session.runModel).toEqual({ provider: 'p', modelId: 'new' });
    expect(events.some((event) => event.type === 'model_changed')).toBe(true);
  });

  test('config_option_update adopts the agent’s list and announces it', () => {
    const { session, events } = mountSession();
    session.configOptions = [modelOption('p/old', ['p/old'])];
    session.runModel = { provider: 'p', modelId: 'old' };

    notify(session, { sessionUpdate: 'config_option_update', configOptions: [modelOption('p/next', ['p/old', 'p/next'])] });

    expect(session.runModel).toEqual({ provider: 'p', modelId: 'next' });
    expect(events.some((event) => event.type === 'model_changed')).toBe(true);
  });

  test('assistant frames carry the model that served them', async () => {
    const { session, events, turn } = mountSession();
    session.runModel = { provider: 'kenari', modelId: 'qwen3-8-27b:free' };
    await session.send({ type: 'prompt', message: 'hi' });
    await turn.started;

    notify(session, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } });
    expect(events.find((event) => event.type === 'message_update')?.message).toMatchObject({
      model: 'qwen3-8-27b:free',
      provider: 'kenari',
    });

    turn.finish({ stopReason: 'end_turn' });
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    expect(events.find((event) => event.type === 'message_end')?.message).toMatchObject({
      model: 'qwen3-8-27b:free',
      provider: 'kenari',
    });
  });
});
