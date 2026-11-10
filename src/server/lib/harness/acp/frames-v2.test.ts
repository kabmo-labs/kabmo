/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * v2 frame semantics: whole-message upserts, one tool-call upsert, streaming
 * tool content, keyed plans, and the two extra final statuses.
 *
 * Split from `frames.test.ts` to stay under the file ceiling.
 */

import { describe, expect, test } from 'bun:test';
import { AcpFrameMapper } from '@/server/lib/harness/acp/frames';

describe('acp v2 updates', () => {
  test('a whole agent_message replaces content and a chunk appends to it', () => {
    const mapper = new AcpFrameMapper();
    const whole = mapper.mapUpdate({
      sessionUpdate: 'agent_message',
      messageId: 'm1',
      content: [{ type: 'text', text: 'hello' }],
    });
    expect(whole.at(-1)).toMatchObject({
      type: 'message_update',
      message: { content: [{ type: 'text', text: 'hello' }] },
    });
    const chunk = mapper.mapUpdate({
      sessionUpdate: 'agent_message_chunk',
      messageId: 'm1',
      content: { type: 'text', text: ' world' },
    });
    expect(chunk.at(-1)).toMatchObject({
      type: 'message_update',
      message: { content: [{ type: 'text', text: 'hello world' }] },
    });
  });

  test('a later whole message replaces the text it streamed before', () => {
    const mapper = new AcpFrameMapper();
    mapper.mapUpdate({ sessionUpdate: 'agent_message', messageId: 'm1', content: [{ type: 'text', text: 'old' }] });
    const replaced = mapper.mapUpdate({
      sessionUpdate: 'agent_message',
      messageId: 'm1',
      content: [{ type: 'text', text: 'new' }],
    });
    expect(replaced.at(-1)).toMatchObject({ message: { content: [{ type: 'text', text: 'new' }] } });
  });

  test('a first tool_call_update creates the call and content chunks reach its result', () => {
    const mapper = new AcpFrameMapper();
    const start = mapper.mapUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 't1',
      title: 'Run tests',
      name: 'bash',
      kind: 'execute',
      status: 'in_progress',
    });
    expect(start.some((event) => event.type === 'tool_execution_start')).toBe(true);
    mapper.mapUpdate({
      sessionUpdate: 'tool_call_content_chunk',
      toolCallId: 't1',
      content: { type: 'content', content: { type: 'text', text: 'out' } },
    });
    const end = mapper.mapUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' });
    expect(end[0]).toMatchObject({ type: 'tool_execution_end', output: 'out', isError: false });
  });

  test('cancelled is a final tool status and paused is not', () => {
    const mapper = new AcpFrameMapper();
    mapper.mapUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'p1', status: 'paused' });
    expect(mapper.openCalls()).toEqual(['p1']);
    const cancelled = mapper.mapUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'p1', status: 'cancelled' });
    expect(cancelled[0]).toMatchObject({ type: 'tool_execution_end', isError: true });
  });

  test('plan_update feeds the entries the Todos panel reads', () => {
    const frames = new AcpFrameMapper().mapUpdate({
      sessionUpdate: 'plan_update',
      plan: { type: 'items', planId: 'p1', entries: [{ content: 'step', status: 'pending' }] },
    });
    expect(frames[0]).toMatchObject({ type: 'plan_updated', entries: [{ content: 'step' }] });
  });
});
