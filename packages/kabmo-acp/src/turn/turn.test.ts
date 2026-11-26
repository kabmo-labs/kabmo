import { describe, expect, test, vi } from 'bun:test';
import { AcpRequestError } from '@kabmo-labs/kabmo-acp/mapper/calls';
import { AcpTurns, type AcpTurnSeams } from './turn';

type TurnEnd = Parameters<AcpTurnSeams['onTurnEnd']>[0];

function harness(
  overrides: Partial<AcpTurnSeams> = {},
  options: { silenceMs?: number } = {},
): {
  turns: AcpTurns;
  events: { type: string; errorMessage?: string }[];
  ended: Promise<TurnEnd>;
} {
  const events: { type: string; errorMessage?: string }[] = [];
  const { promise: ended, resolve: resolveEnd } = Promise.withResolvers<TurnEnd>();
  const turns = new AcpTurns({
    emit: (event) => events.push(event as { type: string; errorMessage?: string }),
    prompt: async () => ({}),
    cancelAgent: () => {},
    abandonPrompt: () => {},
    resetMapper: () => {},
    closeMessage: () => [],
    turnMessage: () => null,
    openCalls: () => [],
    onTurnEnd: (info) => resolveEnd(info),
    ...overrides,
  }, options);
  return { turns, events, ended };
}

describe('AcpTurns failure classification', () => {
  test('a turn that ends without an answer is failed, not completed', async () => {
    const { turns, events, ended } = harness();
    turns.start('do the work', undefined);

    const info = await ended;
    expect(info.failed).toBe(true);
    expect(info.failure).toContain('without sending an answer');
    expect(events.some((event) => event.type === 'prompt_error')).toBe(true);
  });

  test('a rejected prompt keeps the agent error and is failed', async () => {
    const { turns, events, ended } = harness({
      prompt: async () => {
        throw new Error('provider exploded');
      },
    });
    turns.start('do the work', undefined);

    const info = await ended;
    expect(info.failed).toBe(true);
    expect(info.failure).toBe('provider exploded');
    expect(events.filter((event) => event.type === 'prompt_error')).toHaveLength(1);
  });

  test('an answered turn is not failed', async () => {
    const { turns, ended } = harness({
      closeMessage: () => [
        {
          type: 'message_end',
          message: { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
        },
      ] as never,
    });
    turns.start('do the work', undefined);

    const info = await ended;
    expect(info.failed).toBeUndefined();
    expect(info.closedMessage).toBe(true);
  });

  test('a v1 error stop is failed even when the agent streamed a partial answer', async () => {
    // Measured shape: a provider failure mid-answer still closes the message,
    // so "did it answer" is true — and reading only that reported the turn as
    // completed, which told a delegated worker's coordinator it had finished.
    const { promise, resolve } = Promise.withResolvers<{ stopReason?: string }>();
    const { turns, ended } = harness({
      prompt: () => promise,
      closeMessage: () => [
        {
          type: 'message_end',
          message: { role: 'assistant', content: [{ type: 'text', text: 'partial' }] },
        },
      ] as never,
    });
    turns.start('do the work', undefined);
    await Promise.resolve();
    await Promise.resolve();
    resolve({ stopReason: 'error' });

    const info = await ended;
    expect(info.failed).toBe(true);
    expect(info.failure).toContain('with an error');
  });

  test('an ACP -32800 answer is a cancelled turn, not a prompt error', async () => {
    const { turns, events, ended } = harness({
      prompt: async () => {
        throw new AcpRequestError('Request cancelled', -32800);
      },
    });
    turns.start('do the work', undefined);

    const info = await ended;
    expect(info.cancelled).toBe(true);
    expect(info.failed).toBeUndefined();
    expect(events.some((event) => event.type === 'prompt_error')).toBe(false);
  });

  test('a cancelled turn is interrupted, never failed', async () => {
    const { turns, ended } = harness({ prompt: () => new Promise(() => {}) });
    turns.start('do the work', undefined);
    // The turn opens on the prompt chain's own microtask; cancel before that is
    // the "nothing to cancel" path and would not emit a turn end.
    await Promise.resolve();
    await Promise.resolve();
    turns.cancel();

    const info = await ended;
    expect(info.cancelled).toBe(true);
    expect(info.failed).toBeUndefined();
  });
});

describe('AcpTurns silence ceiling', () => {
  test('a turn the agent stops reporting on is closed as stranded', async () => {
    vi.useFakeTimers();
    try {
      const { turns, ended } = harness({ prompt: () => new Promise(() => {}) }, { silenceMs: 1_000 });
      turns.start('do the work', undefined);
      await Promise.resolve();
      await Promise.resolve();
      vi.advanceTimersByTime(1_000);

      const info = await ended;
      expect(info.stranded).toBe(true);
      expect(info.failed).toBe(true);
      expect(info.failure).toContain('stopped reporting');
      expect(turns.isStreaming).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test('a frame from the agent defers the ceiling', async () => {
    vi.useFakeTimers();
    try {
      const { turns } = harness({ prompt: () => new Promise(() => {}) }, { silenceMs: 1_000 });
      turns.start('do the work', undefined);
      await Promise.resolve();
      await Promise.resolve();
      vi.advanceTimersByTime(900);
      turns.noteActivity();
      vi.advanceTimersByTime(900);
      // 1.8s of wall clock, but never 1s of SILENCE.
      expect(turns.isStreaming).toBe(true);
      vi.advanceTimersByTime(200);
      expect(turns.isStreaming).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test('a settled turn cannot strand a later one', async () => {
    vi.useFakeTimers();
    try {
      const { turns, events, ended } = harness({}, { silenceMs: 1_000 });
      turns.start('do the work', undefined);
      await ended;
      const before = events.length;
      vi.advanceTimersByTime(5_000);
      expect(events.length).toBe(before);
      expect(turns.isStreaming).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('AcpTurns v2 completion', () => {
  test('acceptance does not end the turn; an idle state_update does', async () => {
    const { turns, ended } = harness();
    turns.completion = 'state';
    turns.start('do the work', undefined);
    await Promise.resolve();
    await Promise.resolve();

    let finished = false;
    void ended.then(() => { finished = true; });
    await Promise.resolve();
    expect(finished).toBe(false);

    turns.onStateUpdate({ state: 'idle', stopReason: 'end_turn' });
    const info = await ended;
    expect(info.stopReason).toBe('end_turn');
    expect(info.cancelled).toBeUndefined();
  });

  test('idle without a stop reason is not a failure in v2', async () => {
    const { turns, ended, events } = harness();
    turns.completion = 'state';
    turns.start('do the work', undefined);
    await Promise.resolve();
    await Promise.resolve();
    turns.onStateUpdate({ state: 'idle' });

    const info = await ended;
    expect(info.failed).toBeUndefined();
    expect(events.some((event) => event.type === 'prompt_error')).toBe(false);
  });

  test('an idle error carries the agent message as the failure', async () => {
    const { turns, ended, events } = harness();
    turns.completion = 'state';
    turns.start('do the work', undefined);
    await Promise.resolve();
    await Promise.resolve();
    turns.onStateUpdate({
      state: 'idle',
      stopReason: 'error',
      error: { code: -32000, message: 'Authentication required' },
    });

    const info = await ended;
    expect(info.failed).toBe(true);
    expect(info.failure).toBe('Authentication required');
    expect(events.some((event) => event.type === 'prompt_error')).toBe(true);
  });

  test('a cancelled v2 turn is not reopened by the cancelled run late states', async () => {
    const { turns, ended } = harness();
    turns.completion = 'state';
    turns.start('do the work', undefined);
    await Promise.resolve();
    await Promise.resolve();
    turns.cancel();
    await ended;
    turns.onStateUpdate({ state: 'running' });
    expect(turns.isStreaming).toBe(false);
    turns.onStateUpdate({ state: 'idle' });
    expect(turns.isStreaming).toBe(false);
  });

  test('agent-initiated work opens a turn and idle closes it', async () => {
    const { turns, ended, events } = harness();
    turns.completion = 'state';
    turns.onStateUpdate({ state: 'running' });
    expect(turns.isStreaming).toBe(true);
    expect(events.some((event) => event.type === 'agent_start')).toBe(true);
    turns.onStateUpdate({ state: 'idle', stopReason: 'end_turn' });
    await expect(ended).resolves.toMatchObject({ stopReason: 'end_turn' });
  });

  test('a running state does not close the turn', async () => {
    const { turns, ended } = harness();
    turns.completion = 'state';
    turns.start('do the work', undefined);
    await Promise.resolve();
    await Promise.resolve();
    turns.onStateUpdate({ state: 'running' });
    turns.onStateUpdate({ state: 'requires_action' });
    turns.onStateUpdate({ state: 'idle', stopReason: 'end_turn' });
    await expect(ended).resolves.toMatchObject({ stopReason: 'end_turn' });
  });
});
