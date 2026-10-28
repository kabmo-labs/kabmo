/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The side turn's frame fold.
 *
 * These pin the three behaviours that are invisible until a reload: a completed
 * message is stored as COMPLETE (its thinking stops pulsing, its usage is the
 * real one), a tool call the model emitted anyway is not rendered as a card for
 * a tool that never ran, and the stored summary is bounded the way omp bounds
 * its own side replies.
 */

import { describe, expect, test } from 'bun:test';
import { boundSideReply } from '@/server/lib/btw/reply';
import { trackTurnMessage, type BtwLifecycleHost } from '@/server/lib/btw/lifecycle.server';
import type { ChatMessageData } from '@/shared/types';

function makeHost(): { host: BtwLifecycleHost; frames: string[] } {
  const frames: string[] = [];
  const host = {
    topicId: 'topic',
    sessionId: 'session',
    sink: { publish: (frame: { type: string }) => frames.push(frame.type), stateChanged: () => {} },
    running: true,
    proc: null,
    idleTimer: null,
    abortTimer: null,
    lastIdleReset: 0,
    turnIndex: 0,
    settling: false,
    messages: [] as ChatMessageData[],
    activity: '',
    disposing: null,
    start: async () => ({} as never),
    teardownChild: async () => {},
  } as unknown as BtwLifecycleHost;
  return { host, frames };
}

const ASSISTANT_WITH_TOOL_CALL = {
  type: 'message_end',
  message: {
    id: 'm1',
    role: 'assistant',
    timestamp: 1,
    content: [
      { type: 'thinking', thinking: 'weighing it up' },
      { type: 'text', text: 'the answer' },
      { type: 'toolCall', id: 'call_1', name: 'read', input: { path: 'x' } },
    ],
    usage: { input: 10, output: 4, totalTokens: 14 },
  },
};

describe('trackTurnMessage', () => {
  test('a completed message is stored as complete, with its usage', () => {
    const { host } = makeHost();
    trackTurnMessage(host, ASSISTANT_WITH_TOOL_CALL as never, false);

    const [row] = host.messages;
    expect(row?.content).toBe('the answer');
    expect(typeof row?.thinking === 'object' ? row.thinking.isGenerating : undefined).toBe(false);
    expect(row?.usage?.totalTokens).toBe(14);
  });

  test('a streaming segment still marks its thinking as generating', () => {
    const { host } = makeHost();
    trackTurnMessage(host, {
      type: 'message_update',
      message: { id: 'm1', role: 'assistant', timestamp: 1, content: [{ type: 'thinking', thinking: 'still going' }] },
    } as never);

    const thinking = host.messages[0]?.thinking;
    expect(typeof thinking === 'object' ? thinking.isGenerating : undefined).toBe(true);
  });

  test('a tool call the model emitted anyway is not rendered', () => {
    const { host } = makeHost();
    trackTurnMessage(host, ASSISTANT_WITH_TOOL_CALL as never, false);

    expect(host.messages[0]?.toolCalls ?? []).toHaveLength(0);
  });

  test('a toolResult frame never becomes a row', () => {
    const { host, frames } = makeHost();
    trackTurnMessage(host, {
      type: 'message_end',
      message: { id: 'r1', role: 'toolResult', toolCallId: 'call_1', content: [{ type: 'text', text: 'file body' }] },
    } as never, false);

    expect(host.messages).toHaveLength(0);
    expect(frames).toHaveLength(0);
  });

  test('a same-id frame replaces the streaming row in place', () => {
    const { host } = makeHost();
    trackTurnMessage(host, { type: 'message_update', message: { id: 'm1', role: 'assistant', timestamp: 1, content: [{ type: 'text', text: 'half' }] } } as never);
    trackTurnMessage(host, { type: 'message_end', message: { id: 'm1', role: 'assistant', timestamp: 1, content: [{ type: 'text', text: 'the answer' }] } } as never, false);

    expect(host.messages).toHaveLength(1);
    expect(host.messages[0]?.content).toBe('the answer');
  });
});

describe('boundSideReply', () => {
  test('a long run of identical lines collapses with a count', () => {
    const reply = ['same', 'same', 'same', 'same', 'same'].join('\n');
    expect(boundSideReply(reply)).toBe('same\n[…5×]');
  });

  test('a run at the limit is left alone', () => {
    const reply = ['same', 'same', 'same'].join('\n');
    expect(boundSideReply(reply)).toBe(reply);
  });

  test('an oversized reply is capped and marked', () => {
    // Comfortably past the 4 KiB cap: 500 lines averaging ~11 bytes.
    const reply = Array.from({ length: 500 }, (_, index) => `line number ${index}`).join('\n');
    const bounded = boundSideReply(reply);
    expect(bounded.endsWith('\n[…truncated]')).toBe(true);
    expect(Buffer.byteLength(bounded, 'utf8')).toBeLessThanOrEqual(4096);
  });

  test('the cap does not split a surrogate pair', () => {
    // 4-byte characters only: a byte-slice would leave a lone surrogate, which
    // JSON round-trips as U+FFFD.
    const reply = '😀'.repeat(1500);
    const bounded = boundSideReply(reply);
    expect(bounded).not.toContain('\uFFFD');
    expect(bounded.endsWith('\n[…truncated]')).toBe(true);
  });

  test('a short reply is untouched', () => {
    expect(boundSideReply('just an answer')).toBe('just an answer');
  });
});
