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
import { PendingPermissions } from '@/server/lib/harness/acp/permissions';
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
  /** How many times the turn-end seam fired (the queue's arming hook). */
  turnEnds: () => number;
  /** The durable run markers written for this session, in order. */
  streamMarks: () => string[];
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
  let turnEndCount = 0;
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
    onTurnEnd: (stopReason) => {
      (session as unknown as { endStream: (reason?: string) => void }).endStream(stopReason);
      turnEndCount += 1;
    },
  });
  const marks: string[] = [];
  Object.assign(session as unknown as Record<string, unknown>, {
    markStream: (status: string) => {
      marks.push(status);
    },
    harness: 'opencode',
    cwd: '/tmp',
    sessionId: 'acp-1',
    turns,
    mapper,
    permissions: new PendingPermissions(),
    accessMode: 'always-ask',
    listeners: new Set<(event: AgentEvent) => void>([(event) => events.push(event)]),
    proc,
    destroyed: false,
  });
  return { session, events, turn, turnEnds: () => turnEndCount, streamMarks: () => marks };
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

/**
 * The access tier decides whether a permission request ever reaches the user.
 *
 * ACP has no `--approval-mode` flag: the CLIENT answers
 * `session/request_permission`. That made the composer's access control inert
 * on this transport (measured: "Full bypass" still raised the approval dialog
 * for a bash call), and the tiers below are omp's own contract, so one label
 * means one thing on both transports.
 */
describe('ACP permission gating', () => {
  interface PermissionHost {
    accessMode: string;
    onClientRequest: (
      id: number,
      method: string,
      params: Record<string, unknown>,
    ) => Promise<unknown>;
  }

  const request = (kind: string): Record<string, unknown> => ({
    sessionId: 'acp-1',
    toolCall: { kind, title: `${kind} thing` },
    options: [
      { optionId: 'deny', kind: 'reject_once' },
      { optionId: 'allow', kind: 'allow_once' },
    ],
  });

  const permission = (session: AcpSession, id: number, kind: string): Promise<unknown> =>
    (session as unknown as PermissionHost).onClientRequest(id, 'session/request_permission', request(kind));

  const dialogs = (events: AgentEvent[]): number =>
    events.filter((event) => event.type === 'extension_ui_request').length;

  test('`yolo` answers an exec request itself, with no dialog', async () => {
    const { session, events } = mountSession();
    (session as unknown as PermissionHost).accessMode = 'yolo';
    expect(await permission(session, 7, 'execute')).toEqual({
      answered: true,
      result: { outcome: { outcome: 'selected', optionId: 'allow' } },
    });
    expect(dialogs(events)).toBe(0);
    expect(session.isBusy()).toBe(false);
  });

  test('`always-ask` still parks an exec request as a dialog', async () => {
    const { session, events } = mountSession();
    expect(await permission(session, 8, 'execute')).toEqual({ answered: false, deferred: true });
    expect(dialogs(events)).toBe(1);
    expect(session.isBusy()).toBe(true);
  });

  test('`always-ask` auto-runs a read-tier request, as omp does', async () => {
    const { session } = mountSession();
    expect(await permission(session, 9, 'read')).toMatchObject({ answered: true });
  });

  test('`write` auto-runs edits and still asks for exec', async () => {
    const { session } = mountSession();
    (session as unknown as PermissionHost).accessMode = 'write';
    expect(await permission(session, 10, 'edit')).toMatchObject({ answered: true });
    expect(await permission(session, 11, 'execute')).toEqual({ answered: false, deferred: true });
  });

  test('a request with no allow option still reaches the user', async () => {
    const { session, events } = mountSession();
    (session as unknown as PermissionHost).accessMode = 'yolo';
    const answer = await (session as unknown as PermissionHost).onClientRequest(12, 'session/request_permission', {
      sessionId: 'acp-1',
      toolCall: { kind: 'execute' },
      options: [{ optionId: 'deny', kind: 'reject_once' }],
    });
    expect(answer).toEqual({ answered: false, deferred: true });
    expect(dialogs(events)).toBe(1);
  });

  test('a prompt carrying the access pick adopts it before the turn', async () => {
    const { session, turn } = mountSession();
    await session.send({ type: 'prompt', message: 'hi', accessMode: 'yolo' });
    await turn.started;
    expect((session as unknown as PermissionHost).accessMode).toBe('yolo');
    turn.finish({ stopReason: 'end_turn' });
  });
});

/**
 * A turn that ends with nothing must SAY so.
 *
 * Measured on pi-acp: when its provider call fails it answers `session/prompt`
 * with `{}` and sends no frames at all, so the bubble stayed empty with no
 * error and the operator could not tell a refusal from an empty answer.
 */
describe('ACP silent turn', () => {
  /** Frames the mapper would have produced for the turn so far. */
  const finishWith = async (message: string, say?: string) => {
    const { session, events, turn } = mountSession();
    await session.send({ type: 'prompt', message });
    await turn.started;
    if (say) {
      (session as unknown as { onNotification: (m: string, p: unknown) => void }).onNotification('session/update', {
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: say } },
      });
    }
    turn.finish({ stopReason: 'end_turn' });
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    return events;
  };

  test('reports an error when no message and no tool call arrived', async () => {
    const events = await finishWith('Say DUMMY_OK');
    const error = events.find((event) => event.type === 'prompt_error');
    expect(error).toMatchObject({ errorMessage: 'The agent ended the turn without sending an answer' });
  });

  test('an answered turn reports no error', async () => {
    const events = await finishWith('Say DUMMY_OK', 'DUMMY_OK');
    expect(events.some((event) => event.type === 'prompt_error')).toBe(false);
    expect(events.some((event) => event.type === 'message_end' || event.type === 'message_update')).toBe(true);
  });

  test('a slash command is exempt: it is answered locally and produces nothing', async () => {
    const events = await finishWith('/kabmo-mode plan on');
    expect(events.some((event) => event.type === 'prompt_error')).toBe(false);
  });
});

/**
 * The sidebar's spinner comes from the `session_stream_state` row, and ACP had
 * no writer for it: measured on a live chat, the transcript streamed while the
 * session row's `aria-label="Running"` mark never appeared (omp's dispatch
 * writes that row; this transport never did). The marker is asserted through the
 * seam so these tests stay database-free.
 */
describe('ACP stream marker', () => {
  test('a turn writes `stream` and closes with `finish`', async () => {
    const { session, turn, streamMarks } = mountSession();
    await session.send({ type: 'prompt', message: 'hello' });
    await turn.started;
    expect(streamMarks()).toEqual(['stream']);

    turn.finish({ stopReason: 'end_turn' });
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    expect(streamMarks()).toEqual(['stream', 'finish']);
  });

  test('a Stop closes the marker as `abort`, not `finish`', async () => {
    const { session, turn, streamMarks } = mountSession();
    await session.send({ type: 'prompt', message: 'long job' });
    await turn.started;
    session.cancelTurn();
    expect(streamMarks()).toEqual(['stream', 'abort']);
  });

  test('a refused prompt writes nothing', async () => {
    const { session, turn, streamMarks } = mountSession();
    await session.send({ type: 'prompt', message: 'first' });
    await turn.started;
    await expect(session.send({ type: 'prompt', message: 'second' })).rejects.toThrow('already processing');
    expect(streamMarks()).toEqual(['stream']);
    turn.finish({ stopReason: 'end_turn' });
  });
});
