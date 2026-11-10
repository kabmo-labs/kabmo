/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What an ACP session REPORTS: the durable run marker the sidebar's spinner
 * reads, the answer a silent turn must give, and the session facts the panels
 * read (message count, plan capability, the agent's own command list).
 *
 * omp reports all of these from its transcript; the ACP driver had none of them
 * (`messageCount` was hard-coded 0, `get_commands` answered `[]`, and no
 * `session_stream_state` row was ever written), so the composer's `/` pool, the
 * context panel and the sidebar described a different agent.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { mountSession, notify } from '@/server/lib/harness/acp/session.test-util';
import { loadAcpSessions, saveHarnessSession } from '@/server/lib/harness/session-store.server';
import { onRealtimeSignal } from '@/server/lib/realtime/signals.server';

// A prompt reaches the title writer, which opens the database — isolate it.
beforeEach(async () => {
  await isolateDb();
});

afterEach(async () => {
  await releaseDb();
});

/**
 * A turn that ends with nothing must SAY so.
 *
 * Measured on pi-acp: when its provider call fails it answers `session/prompt`
 * with `{}` and sends no frames at all, so the bubble stayed empty with no
 * error and the operator could not tell a refusal from an empty answer.
 */
describe('ACP silent turn', () => {
  const finishWith = async (message: string, say?: string) => {
    const { session, events, turn } = mountSession();
    await session.send({ type: 'prompt', message });
    await turn.started;
    if (say) notify(session, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: say } });
    turn.finish({ stopReason: 'end_turn' });
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    return events;
  };

  test('reports an error when no message and no tool call arrived', async () => {
    const events = await finishWith('Say DUMMY_OK');
    const error = events.find((event) => event.type === 'prompt_error');
    expect(error).toMatchObject({ errorMessage: 'The agent ended the turn without sending an answer' });
  });

  test('a whitespace-only chunk is the same silent failure', async () => {
    // The row renders no text, so a frame that carries only spaces looks exactly
    // like an empty bubble — reporting it is the only way the operator learns
    // the turn failed.
    const events = await finishWith('Say DUMMY_OK', '   \n ');
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
 * session row's `aria-label="Running"` mark never appeared. The marker is
 * asserted through the seam so these cases stay free of the row's own module.
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
    // `await` is what makes the assertion run: `.rejects` resolves the check.
    await expect(session.send({ type: 'prompt', message: 'second' })).rejects.toThrow('already processing');
    expect(streamMarks()).toEqual(['stream']);
    turn.finish({ stopReason: 'end_turn' });
  });
});

describe('ACP session facts', () => {
  test('counts the prompt and every closed assistant message', async () => {
    const { session, turn } = mountSession();
    await session.send({ type: 'prompt', message: 'hello' });
    await turn.started;
    expect(session.messageCount).toBe(1);

    notify(session, { sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: 'one' } });
    notify(session, { sessionUpdate: 'agent_message_chunk', messageId: 'm2', content: { type: 'text', text: 'two' } });
    expect(session.messageCount).toBe(2);
    turn.finish({ stopReason: 'end_turn' });
  });

  test('a closed assistant message increments the count, a silent end does not', () => {
    const { session } = mountSession();
    session.onTurnEnded({ closedMessage: true });
    expect(session.messageCount).toBe(1);
    session.onTurnEnded({ closedMessage: false, stopReason: 'cancelled' });
    expect(session.messageCount).toBe(1);
  });

  test('observes a plan update, which the panels gate on', () => {
    const { session } = mountSession();
    expect(session.capabilities.hasPlan).not.toBe(true);
    notify(session, { sessionUpdate: 'plan' });
    expect(session.capabilities.hasPlan).toBe(true);
  });

  test('folds usage_update into the numbers the context ring reads', () => {
    const { session } = mountSession();
    notify(session, { sessionUpdate: 'usage_update', size: 1000, used: 250, cost: { amount: 0.5 } });
    expect(session.contextUsage).toEqual({ tokens: 250, contextWindow: 1000, percent: 25 });
    expect(session.totalCost).toBe(0.5);
    expect(session.webState()).toMatchObject({
      contextUsage: { tokens: 250, contextWindow: 1000, percent: 25 },
      totalCost: 0.5,
      userCount: 0,
      assistantCount: 0,
    });
  });

  test('keeps the agent’s own command list and answers `get_commands` with it', async () => {
    const { session } = mountSession();
    notify(session, {
      sessionUpdate: 'available_commands_update',
      availableCommands: [
        { name: 'deep-research', description: 'Deep research', input: { hint: '<query>' } },
        { name: 'dataviz' },
        { name: 42 },
      ],
    });
    expect(session.agentCommands).toEqual([
      { name: 'deep-research', description: 'Deep research', inputHint: '<query>' },
      { name: 'dataviz' },
    ]);
    expect(await session.send({ type: 'get_commands' })).toEqual({ commands: session.agentCommands });
  });

  test('presents a notice that arrives with no turn open', () => {
    const { session, events } = mountSession();
    // `session.notices` is advertised, so a spec-compliant agent sends these
    // between turns. The turn gate exists for abandoned output, not for a live
    // notice — dropping it here would have made the advertisement a lie.
    notify(session, {
      sessionUpdate: 'notice',
      severity: 'warning',
      title: 'MCP server unavailable',
      description: 'Continuing without it.',
    });
    expect(events.at(-1)).toEqual({
      type: 'notice',
      level: 'warning',
      message: 'MCP server unavailable — Continuing without it.',
    });
  });

  test('records the agent’s own title, which arrives BETWEEN turns', async () => {
    const { session } = mountSession();
    await saveHarnessSession({ sessionId: 'acp-1', harness: 'opencode', agentSessionId: '', cwd: '/tmp' });

    // No turn is open here — that is the case that used to drop the frame, so an
    // agent naming its chat (measured on claude, after the first answer) left the
    // sidebar row saying whatever the first prompt said, forever.
    const written = Promise.withResolvers<void>();
    const off = onRealtimeSignal((event) => {
      if (event.signal === 'sidebar-structure') written.resolve();
    });
    try {
      notify(session, { sessionUpdate: 'session_info_update', title: 'Release train' });
      await written.promise;
    } finally {
      off();
    }

    const [row] = await loadAcpSessions();
    expect(row.title).toBe('Release train');
  });

  test('publishes the legacy mode list as a selector every consumer reads', () => {
    const { session } = mountSession();
    session.modes = {
      currentModeId: 'plan',
      availableModes: [{ id: 'plan', name: 'Plan' }, { id: 'code', name: 'Code' }],
    };
    expect(session.webState().configOptions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'mode', category: 'mode', currentValue: 'plan' }),
    ]));
  });

  test('an agent-initiated mode change is adopted by the session', () => {
    const { session } = mountSession();
    session.modes = { currentModeId: 'code', availableModes: [{ id: 'code', name: 'Code' }] };
    notify(session, { sessionUpdate: 'current_mode_update', currentModeId: 'plan' });
    expect(session.modes?.currentModeId).toBe('plan');
  });

  test('agent-side delete runs only when the agent advertises it', async () => {
    const { session, deletedSessions } = mountSession();
    await session.deleteAgentSession();
    expect(deletedSessions()).toEqual([]);
    session.capabilities = { ...session.capabilities, deleteSession: true };
    await session.deleteAgentSession();
    expect(deletedSessions()).toEqual(['acp-1']);
  });

  test('an image prompt is refused when the agent did not advertise image', () => {
    const { session } = mountSession();
    expect(() => session.startTurn('look', [{ data: 'AAAA', mimeType: 'image/png' }]))
      .toThrow('does not accept image attachments');
  });
});
