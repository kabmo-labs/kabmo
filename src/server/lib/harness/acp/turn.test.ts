import { describe, expect, test } from 'bun:test';
import { AcpTurns, type AcpTurnSeams } from '@/server/lib/harness/acp/turn';

type TurnEnd = Parameters<AcpTurnSeams['onTurnEnd']>[0];

function harness(overrides: Partial<AcpTurnSeams> = {}): {
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
    openCalls: () => [],
    onTurnEnd: (info) => resolveEnd(info),
    ...overrides,
  });
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
