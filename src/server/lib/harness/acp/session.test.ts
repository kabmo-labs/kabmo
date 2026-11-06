/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What an ACP `prompt` dispatch ANSWERS.
 *
 * The route's reply means "the turn was accepted", and the client builds on
 * exactly that: `sendNewPrompt` adopts the session id and attaches its stream on
 * the response. Returning the turn instead parked a brand-new opencode chat on
 * `new-…` for the answer's whole duration — measured in a real browser: the URL
 * stayed `?sessionId=new-…`, the docked indicator read "Loading", and the
 * transcript never appeared while the turn was running fine.
 *
 * The turn's own end is the `agent_end` frame, which is what the second case
 * pins: the ack arrives immediately, and the terminal frame arrives when the
 * agent is done.
 *
 * The session is built WITHOUT its constructor: constructing one spawns a real
 * `opencode acp` child, and the whole subject here is the dispatch, not the
 * transport.
 */

import { describe, expect, test } from 'bun:test';
import { AcpSession } from '@/server/lib/harness/acp/session';
import { AcpFrameMapper } from '@/server/lib/harness/acp/frames';
import { AcpTurns } from '@/server/lib/harness/acp/turn';
import type { AgentEvent } from '@/server/lib/omp/rpc/constants';

interface Turn {
  /** Resolves once `session/prompt` has actually been sent. The dispatch is
   *  chained behind the previous turn's request, so it is one tick later than
   *  the ACK and every assertion below has to wait for it. */
  started: Promise<void>;
  /** How many `session/prompt` requests have been sent. */
  calls: () => number;
  /** Settle the pending `session/prompt` call. */
  finish: (result: { stopReason?: string }) => void;
  fail: (error: unknown) => void;
}

function mountSession(): {
  session: AcpSession;
  events: AgentEvent[];
  turn: Turn;
} {
  const events: AgentEvent[] = [];
  const dispatched = Promise.withResolvers<void>();
  type Pending = ReturnType<typeof Promise.withResolvers<unknown>>;
  const calls: Pending[] = [];
  const turn: Turn = {
    started: dispatched.promise,
    calls: () => calls.length,
    finish: (result) => calls.at(-1)?.resolve(result),
    fail: (error) => calls.at(-1)?.reject(error),
  };

  const session = Object.create(AcpSession.prototype) as AcpSession;
  const mapper = new AcpFrameMapper();
  const proc = {
    prompt: async (_message: string, _images: unknown) => {
      const pending = Promise.withResolvers<unknown>();
      calls.push(pending);
      dispatched.resolve();
      return pending.promise;
    },
    cancel: () => {},
    abandonPrompt: () => calls.at(-1)?.resolve({ stopReason: 'cancelled' }),
    isAlive: true,
  };
  const turns = new AcpTurns({
    emit: (event) => (session as unknown as { emit: (e: AgentEvent) => void }).emit(event),
    prompt: (message, images) => proc.prompt(message, images) as Promise<{ stopReason?: string } | undefined>,
    cancelAgent: () => proc.cancel(),
    abandonPrompt: () => proc.abandonPrompt(),
    resetMapper: () => mapper.reset(),
    closeMessage: () => mapper.closeMessage(),
    openCalls: () => mapper.openCalls(),
  });
  Object.assign(session as unknown as Record<string, unknown>, {
    harness: 'opencode',
    cwd: '/tmp',
    sessionId: 'acp-1',
    turns,
    mapper,
    listeners: new Set<(event: AgentEvent) => void>([(event) => events.push(event)]),
    proc,
    destroyed: false,
  });
  return { session, events, turn };
}

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

  test('a failed turn reports its error and still closes the turn', async () => {
    const { session, events, turn } = mountSession();
    await session.send({ type: 'prompt', message: 'hello' });
    await turn.started;
    turn.fail(new Error('agent exploded'));
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    expect(events.some((event) => event.type === 'prompt_error')).toBe(true);
    expect(session.isPromptRunning).toBe(false);
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
    const { session, events, turn } = mountSession();
    (session as unknown as { proc: Record<string, unknown> }).proc.cancel = () => {};
    await session.send({ type: 'prompt', message: 'long job' });
    session.cancelTurn();
    turn.finish({ stopReason: 'cancelled' });
    for (let i = 0; i < 4; i += 1) await Promise.resolve();

    const ends = events.filter((event) => event.type === 'agent_end');
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ type: 'agent_end', isTerminal: true, cancelled: true });
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
