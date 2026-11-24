/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Where a row ENDS. The timeline draws a row's blocks in a fixed order —
 * thinking, then the answer text, then the tool cards — so a row that holds a
 * card and the prose written after it draws the ANSWER first. Measured on
 * session 9ea5a178 (antigravity): frames arrived `tool_call run_command` →
 * `tool_execution_end` → thought → `agent_message_chunk` "Ini gambarnya!…", the
 * merged row rendered `"Ini gambarnya!Run Command… Done"`, and the same
 * transcript split rendered `"Run Command… DoneIni gambarnya!"` — arrival order.
 *
 * Split from `frames.test.ts` to stay under the file ceiling.
 */

import { describe, expect, test } from 'bun:test';
import { AcpFrameMapper } from '@/server/lib/harness/acp/frames';

const anonymousChunk = (text: string) => ({
  sessionUpdate: 'agent_message_chunk',
  content: { type: 'text', text },
});

const messageIdOf = (frame: unknown): string | undefined => {
  if (!frame || typeof frame !== 'object' || !('message' in frame)) return undefined;
  const message = frame.message;
  if (!message || typeof message !== 'object' || !('id' in message)) return undefined;
  return typeof message.id === 'string' ? message.id : undefined;
};

const contentOf = (frame: unknown): { type: string; text?: string; thinking?: string }[] => {
  if (!frame || typeof frame !== 'object' || !('message' in frame)) return [];
  const message = frame.message;
  if (!message || typeof message !== 'object' || !('content' in message)) return [];
  const content = message.content;
  return Array.isArray(content) ? (content as { type: string; text?: string; thinking?: string }[]) : [];
};

describe('acp frame mapper — row boundaries', () => {
  test('a tool call and the prose after it are TWO rows, in arrival order', () => {
    const mapper = new AcpFrameMapper();
    const opened = mapper.mapUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 't1',
      title: 'Read',
      status: 'in_progress',
    });
    const frames = mapper.mapUpdate(anonymousChunk('done'));
    expect(frames.map((frame) => frame.type)).toEqual(['message_end', 'message_update']);
    expect(messageIdOf(frames[1])).not.toBe(messageIdOf(opened[0]));
    // The closed row is the CARD's row, not a copy of the answer.
    expect(contentOf(frames[0]).map((block) => block.type)).toEqual(['toolCall']);
    expect(messageIdOf(mapper.closeMessage()[0])).toBe(messageIdOf(frames[1]));
  });

  test('prose before a card stays in its own row', () => {
    const mapper = new AcpFrameMapper();
    mapper.mapUpdate(anonymousChunk('checking'));
    const frames = mapper.mapUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 't2',
      title: 'Read',
      status: 'in_progress',
    });
    expect(frames.map((frame) => frame.type)).toEqual([
      'message_end',
      'message_update',
      'tool_execution_start',
    ]);
    expect(contentOf(frames[0])).toEqual([{ type: 'text', text: 'checking' }]);
    // The card row is fresh, not the closed prose row's identity.
    expect(messageIdOf(frames[1])).not.toBe(messageIdOf(frames[0]));
  });

  test('thinking written after a card is its own row too', () => {
    const mapper = new AcpFrameMapper();
    mapper.mapUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 't3',
      title: 'Read',
      status: 'in_progress',
    });
    const frames = mapper.mapUpdate({
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'hmm' },
    });
    expect(frames.map((frame) => frame.type)).toEqual(['message_end', 'message_update']);
    expect(contentOf(frames[1])).toEqual([{ type: 'thinking', thinking: 'hmm' }]);
  });

  test('consecutive cards share ONE row', () => {
    const mapper = new AcpFrameMapper();
    const first = mapper.mapUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'a1',
      title: 'Read',
      status: 'in_progress',
    });
    const second = mapper.mapUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'b1',
      title: 'Read',
      status: 'in_progress',
    });
    expect(second.map((frame) => frame.type)).toEqual(['message_update', 'tool_execution_start']);
    expect(messageIdOf(second[0])).toBe(messageIdOf(first[0]));
    expect(contentOf(second[0]).map((block) => block.type)).toEqual(['toolCall', 'toolCall']);
  });

  test('the turn-level message keeps every row, for the background probe', () => {
    // Rows are split for the timeline, but `endAcpTurn` asks the closed turn
    // whether it handed work to a background worker and what its answer was.
    // The last row alone answered "no tool call" for a turn that spawned one.
    const mapper = new AcpFrameMapper();
    mapper.reset();
    mapper.mapUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'c1',
      name: 'invoke_subagent',
      status: 'in_progress',
    });
    mapper.mapUpdate(anonymousChunk('done'));
    mapper.closeMessage();
    const content = mapper.turnMessage()?.content as { type: string }[];
    expect(content.map((block) => block.type)).toEqual(['toolCall', 'text']);
  });

  test('a new turn starts an empty aggregate', () => {
    const mapper = new AcpFrameMapper();
    mapper.mapUpdate(anonymousChunk('one'));
    mapper.closeMessage();
    mapper.reset();
    expect(mapper.turnMessage()).toBeNull();
  });

  test('closing an already-closed row emits nothing', () => {
    const mapper = new AcpFrameMapper();
    mapper.mapUpdate(anonymousChunk('one'));
    expect(mapper.closeMessage()).toHaveLength(1);
    expect(mapper.closeMessage()).toEqual([]);
  });
});
