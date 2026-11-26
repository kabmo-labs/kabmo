/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What a prompt does before it reaches the wire.
 *
 * Two rules that a caller can see from outside: an image the agent never
 * advertised is REFUSED with a sentence (rather than sent into a dispatcher that
 * throws), and a mid-turn message on an agent with no steering extension is
 * QUEUED for the next turn instead of being lost.
 */

import { describe, expect, test } from 'bun:test';
import { startAcpPrompt, sendAcpMidTurn, type AcpPromptHost } from '@kabmo-labs/kabmo-acp/session-config/session-intake';

function host(overrides: Partial<AcpPromptHost> = {}): AcpPromptHost & {
  events: string[];
  queued: string[];
  steered: unknown[][];
  turns: number;
} {
  const events: string[] = [];
  const queued: string[] = [];
  const steered: unknown[][] = [];
  const state = {
    cwd: '/tmp',
    harness: 'claude',
    acceptsImages: false,
    promptCount: 0,
    background: { stop: () => events.push('background-stop') },
    usage: { beginTurn: () => events.push('usage-begin') },
    beginTurn: () => {
      state.turns += 1;
      events.push('turn');
      return { agentInvoked: true };
    },
    emit: (event: Record<string, unknown> & { type: string }) => events.push(event.type),
    steer: async (blocks: unknown[]) => {
      steered.push(blocks);
      return { steered: true };
    },
    queueTurnInput: (_message: string) => {
      queued.push(_message);
    },
    events,
    queued,
    steered,
    turns: 0,
  };
  return Object.assign(state, overrides);
}

describe('startAcpPrompt', () => {
  test('opens the turn and records the user row', () => {
    const h = host();
    expect(startAcpPrompt(h, 'hello', undefined)).toEqual({ agentInvoked: true });
    expect(h.turns).toBe(1);
    expect(h.promptCount).toBe(1);
    expect(h.events).toEqual(['background-stop', 'usage-begin', 'turn', 'user_turn']);
  });

  test('a quiet prompt opens a turn but draws no user row', () => {
    const h = host();
    expect(startAcpPrompt(h, 'continue', undefined, { quiet: true })).toEqual({ agentInvoked: true });
    expect(h.turns).toBe(1);
    expect(h.promptCount).toBe(1);
    expect(h.events).toEqual(['background-stop', 'usage-begin', 'turn']);
  });

  test('an image the agent never advertised is refused before any turn opens', () => {
    const h = host();
    expect(() => startAcpPrompt(h, 'look', [{ data: 'x', mimeType: 'image/png' }])).toThrow(
      'This harness does not accept image attachments (claude)',
    );
    expect(h.turns).toBe(0);
  });

  test('an advertised image capability lets the turn run', () => {
    const h = host({ acceptsImages: true });
    expect(() => startAcpPrompt(h, 'look', [{ data: 'x', mimeType: 'image/png' }])).not.toThrow();
    expect(h.turns).toBe(1);
  });
});

describe('sendAcpMidTurn', () => {
  test('an agent with a steering extension gets the call', async () => {
    const h = host();
    await sendAcpMidTurn(h, 'steering', 'go on', undefined, true);
    expect(h.steered).toHaveLength(1);
    expect(h.queued).toEqual([]);
  });

  test('an agent without one gets the message HELD, not refused', async () => {
    const h = host();
    expect(await sendAcpMidTurn(h, 'followUp', 'later', undefined, false)).toEqual({ queued: true });
    expect(h.queued).toEqual(['later']);
    expect(h.steered).toEqual([]);
  });
});
