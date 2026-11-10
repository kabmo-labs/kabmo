/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The timeline fields ACP frames did not carry: a message stamp at first
 * chunk, and the turn's measured duration at close. Without them the assistant
 * footer had no date or response time for any ACP harness.
 *
 * Split from `frames.test.ts` to stay under the file ceiling.
 */

import { describe, expect, test } from 'bun:test';
import { AcpFrameMapper } from '@/server/lib/harness/acp/frames';
import { toChatMessage } from '@/shared/lib/omp/session/mapper';

const textChunk = (text: string, messageId = 'm1') => ({
  sessionUpdate: 'agent_message_chunk',
  content: { type: 'text', text },
  messageId,
});

/** The frame's message as a record, for assertions on fields the event type
 *  widens to `unknown`. The mapper built it, so the shape is ours. */
const messageOf = (frame: unknown): Record<string, unknown> | null => {
  if (!frame || typeof frame !== 'object' || !('message' in frame)) return null;
  const message = frame.message;
  return message && typeof message === 'object' ? message as Record<string, unknown> : null;
};

describe('acp frame mapper — message timing', () => {
  test('stamps the message start once, not every chunk', () => {
    const mapper = new AcpFrameMapper();
    const first = messageOf(mapper.mapUpdate(textChunk('hello '))[0]);
    const second = messageOf(mapper.mapUpdate(textChunk('world'))[0]);
    expect(typeof first?.timestamp).toBe('number');
    expect(second?.timestamp).toBe(first?.timestamp);
  });

  test('the closed message carries a duration measured from the turn start', () => {
    const mapper = new AcpFrameMapper();
    mapper.reset(1_000);
    mapper.mapUpdate(textChunk('done'));
    const message = messageOf(mapper.closeMessage()[0]);
    const { timestamp, completedAt, duration } = message ?? {};
    if (typeof timestamp !== 'number' || typeof completedAt !== 'number' || typeof duration !== 'number') {
      throw new Error('message_end is missing its timing fields');
    }
    expect(timestamp).toBeGreaterThanOrEqual(1_000);
    expect(completedAt).toBeGreaterThanOrEqual(timestamp);
    expect(duration).toBe(completedAt - 1_000);
  });

  test('the client mapper turns those fields into the footer stamp and duration', () => {
    const mapper = new AcpFrameMapper();
    mapper.reset(1_000);
    mapper.mapUpdate(textChunk('done'));
    const message = messageOf(mapper.closeMessage()[0]);
    if (!message) throw new Error('message_end carried no message');
    const converted = toChatMessage(message, false);
    expect(converted?.date).toStartWith('Today,');
    expect(converted?.timestamp).toMatch(/^\d{1,2}:\d{2}\s(AM|PM)$/);
    const duration = message.duration;
    if (typeof duration !== 'number') throw new Error('message_end carried no duration');
    expect(converted?.durationMs).toBe(duration);
  });
});
