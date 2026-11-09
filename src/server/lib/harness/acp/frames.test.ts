/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The ACP <-> Kabmo translation, which is the whole adapter contract.
 *
 * Each case here is a measured agent behaviour, not a hypothetical:
 *
 *  - `tool_call_update` arrives as a PATCH, so a `completed` update carrying
 *    only `status` must not blank the card it completes;
 *  - `messageId` is the ONLY message delimiter (ACP has no `message_end`), so a
 *    changed id must close the previous row instead of appending into it; an
 *    ABSENT id (antigravity 1.5.3) must still yield one stable row per turn;
 *  - `kind` must reach `ToolCallData.type`, because omp's `ToolType` is what the
 *    renderers switch on;
 *  - `usage_update` exists on some agents only, so its absence must emit
 *    nothing rather than a zero that reads like a measurement.
 */

import { describe, expect, test } from 'bun:test';
import { AcpFrameMapper, turnEndFrame } from '@/server/lib/harness/acp/frames';
import {
  acpContentText,
  acpToolOutput,
  acpToolTarget,
  toolTypeFor,
} from '@/server/lib/harness/acp/mapper';

const textChunk = (text: string, messageId = 'm1') => ({
  sessionUpdate: 'agent_message_chunk',
  content: { type: 'text', text },
  messageId,
});

/** ACP v1 allows `messageId` to be absent; antigravity 1.5.3 sends none. */
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

describe('acp frame mapper — assistant text', () => {
  test('accumulates chunks into ONE message rather than one row per delta', () => {
    const mapper = new AcpFrameMapper();
    mapper.mapUpdate(textChunk('hello '));
    const frames = mapper.mapUpdate(textChunk('world'));
    expect(frames).toHaveLength(1);
    const message = frames[0].message as { content: { type: string; text: string }[] };
    expect(message.content[0]).toEqual({ type: 'text', text: 'hello world' });
  });

  test('chunks without a messageId still update ONE row', () => {
    const mapper = new AcpFrameMapper();
    const first = mapper.mapUpdate(anonymousChunk('hello '));
    const second = mapper.mapUpdate(anonymousChunk('world'));
    const firstId = messageIdOf(first[0]);
    expect(typeof firstId).toBe('string');
    expect(messageIdOf(second[0])).toBe(firstId);
    // The final frame must carry that SAME id, or the client appends the
    // completed answer beside the streamed one.
    const ended = mapper.closeMessage();
    expect(messageIdOf(ended[0])).toBe(firstId);
  });

  test('a tool call before the first chunk keeps that identity too', () => {
    const mapper = new AcpFrameMapper();
    const opened = mapper.mapUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 't1',
      title: 'Read',
      status: 'in_progress',
    });
    const chunk = mapper.mapUpdate(anonymousChunk('done'));
    const openedId = messageIdOf(opened[0]);
    expect(typeof openedId).toBe('string');
    expect(messageIdOf(chunk[0])).toBe(openedId);
  });

  test('a new turn gets a fresh identity when the agent sends no id', () => {
    const mapper = new AcpFrameMapper();
    const first = mapper.mapUpdate(anonymousChunk('one'));
    mapper.reset();
    const second = mapper.mapUpdate(anonymousChunk('two'));
    expect(messageIdOf(second[0])).not.toBe(messageIdOf(first[0]));
  });

  test('a changed messageId closes the previous row first', () => {
    const mapper = new AcpFrameMapper();
    mapper.mapUpdate(textChunk('first', 'm1'));
    const frames = mapper.mapUpdate(textChunk('second', 'm2'));
    expect(frames.map((frame) => frame.type)).toEqual(['message_end', 'message_update']);
  });

  test('thinking chunks stay in their own block', () => {
    const mapper = new AcpFrameMapper();
    mapper.mapUpdate({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'hmm' }, messageId: 'm1' });
    const frames = mapper.mapUpdate(textChunk('answer', 'm1'));
    const message = frames[0].message as { content: { type: string }[] };
    expect(message.content.map((block) => block.type)).toEqual(['thinking', 'text']);
  });

  test('user chunks are receipts, not new rows', () => {
    const mapper = new AcpFrameMapper();
    expect(mapper.mapUpdate({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'hi' } })).toEqual([]);
  });
});

describe('acp frame mapper — tool calls', () => {
  const openTail = {
    sessionUpdate: 'tool_call',
    toolCallId: 'c1',
    name: 'read',
    title: 'Reading hello.txt',
    kind: 'read',
    status: 'pending',
    rawInput: { path: 'hello.txt' },
    locations: [{ path: '/tmp/hello.txt' }],
  };

  test('a tool call becomes a block on the message AND a start frame', () => {
    const mapper = new AcpFrameMapper();
    const frames = mapper.mapUpdate(openTail);
    expect(frames.map((frame) => frame.type)).toEqual(['message_update', 'tool_execution_start']);
    const message = frames[0].message as { content: { type: string; id: string; name: string }[] };
    expect(message.content[0]).toMatchObject({ type: 'toolCall', id: 'c1', name: 'read' });
    expect(frames[1]).toMatchObject({ toolCallId: 'c1', toolType: 'read', target: '/tmp/hello.txt' });
  });

  test('a completion PATCH keeps the card the opening frame drew', () => {
    const mapper = new AcpFrameMapper();
    mapper.mapUpdate(openTail);
    const frames = mapper.mapUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'c1',
      status: 'completed',
      rawOutput: { content: [{ type: 'text', text: '1|hello' }] },
    });
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ type: 'tool_execution_end', toolCallId: 'c1', isError: false });
    expect(frames[0].output).toBe('1|hello');
  });

  test('an in-progress patch is an update, not an end', () => {
    const mapper = new AcpFrameMapper();
    mapper.mapUpdate(openTail);
    const frames = mapper.mapUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'c1',
      status: 'in_progress',
      rawOutput: { content: [{ type: 'text', text: 'reading…' }] },
    });
    expect(frames[0].type).toBe('tool_execution_update');
    // The flattened read rides the frame: the client's generic walker does not
    // know ACP's nested `{type:"content"}` envelope.
    expect(frames[0].output).toBe('reading…');
  });

  test('a nested content envelope still yields output on the frame', () => {
    const mapper = new AcpFrameMapper();
    mapper.mapUpdate(openTail);
    const frames = mapper.mapUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'c1',
      status: 'completed',
      rawOutput: { content: [{ type: 'content', content: { type: 'text', text: 'nested' } }] },
    });
    expect(frames[0]).toMatchObject({ type: 'tool_execution_end', output: 'nested' });
  });

  test('a call announced already-completed is closed once, not left spinning', () => {
    // Some agents send ONE `tool_call` with status completed and no update.
    // The old mapper kept it open, so the turn's cleanup closed it as an error.
    const mapper = new AcpFrameMapper();
    const frames = mapper.mapUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'c2',
      name: 'Shell',
      kind: 'execute',
      status: 'completed',
      rawInput: { command: 'ls' },
      rawOutput: { content: [{ type: 'text', text: 'done' }], details: { exitCode: 0 } },
    });
    expect(frames.map((frame) => frame.type)).toEqual([
      'message_update',
      'tool_execution_start',
      'tool_execution_end',
    ]);
    expect(frames[1]).toMatchObject({ toolType: 'bash' });
    expect(frames[2]).toMatchObject({ isError: false, output: 'done', details: { exitCode: 0 } });
    expect(mapper.openCalls()).toEqual([]);
  });

  test('the message block carries the transport type for the renderer', () => {
    const mapper = new AcpFrameMapper();
    const frames = mapper.mapUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'c3',
      name: 'Shell',
      kind: 'execute',
      status: 'pending',
    });
    const message = frames[0].message as { content: { toolType?: string }[] };
    expect(message.content[0]?.toolType).toBe('bash');
  });

  test('a diff content block becomes details.diff for the Edit panel', () => {
    const mapper = new AcpFrameMapper();
    mapper.mapUpdate(openTail);
    const frames = mapper.mapUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'c1',
      status: 'completed',
      content: [{ type: 'diff', path: 'src/a.ts', oldText: 'a\nb', newText: 'a\nc' }],
    });
    const details = frames[0].details as { diff?: string; path?: string };
    expect(details.path).toBe('src/a.ts');
    expect(details.diff).toContain('-b');
    expect(details.diff).toContain('+c');
  });

  test('content-only output reaches the card', () => {
    const mapper = new AcpFrameMapper();
    mapper.mapUpdate(openTail);
    const frames = mapper.mapUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'c1',
      status: 'completed',
      content: [{ type: 'text', text: 'from content' }],
    });
    expect(frames[0].output).toBe('from content');
    expect(frames[0].result).toEqual({ content: [{ type: 'text', text: 'from content' }] });
  });

  test('failed maps to isError, and openCalls drains', () => {
    const mapper = new AcpFrameMapper();
    mapper.mapUpdate(openTail);
    expect(mapper.openCalls()).toEqual(['c1']);
    const frames = mapper.mapUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'c1',
      status: 'failed',
      rawOutput: { content: [{ type: 'text', text: 'boom' }] },
    });
    expect(frames[0].isError).toBe(true);
    expect(mapper.openCalls()).toEqual([]);
  });

  test('kind decides the renderer type, and a real name wins over `other`', () => {
    expect(toolTypeFor('execute', undefined)).toBe('bash');
    expect(toolTypeFor('search', undefined)).toBe('grep');
    expect(toolTypeFor('delete', 'rm')).toBe('edit');
    expect(toolTypeFor('switch_mode', undefined)).toBe('todo');
    expect(toolTypeFor('other', 'edit')).toBe('edit');
    expect(toolTypeFor(undefined, 'view_file')).toBe('read');
  });
});

describe('acp frame mapper — optional telemetry', () => {
  test('usage_update forwards size/used/cost', () => {
    const mapper = new AcpFrameMapper();
    const frames = mapper.mapUpdate({ sessionUpdate: 'usage_update', size: 1_000_000, used: 5216, cost: { amount: 0.00004, currency: 'USD' } });
    expect(frames[0]).toMatchObject({ type: 'usage_updated', size: 1_000_000, used: 5216 });
  });

  test('an agent that reports no usage emits nothing at all', () => {
    const mapper = new AcpFrameMapper();
    expect(mapper.mapUpdate({ sessionUpdate: 'usage_update' })).toEqual([]);
    expect(mapper.mapUpdate({ sessionUpdate: 'plan', entries: [] })[0]).toMatchObject({ type: 'plan_updated' });
  });

  test('an unknown variant is ignored, never an error', () => {
    const mapper = new AcpFrameMapper();
    expect(mapper.mapUpdate({ sessionUpdate: 'brand_new_thing' })).toEqual([]);
  });
});

describe('acp frame mapper — turn terminal', () => {
  test('a cancelled stopReason reports cancellation', () => {
    expect(turnEndFrame({ stopReason: 'cancelled' })).toMatchObject({ type: 'agent_end', isTerminal: true, cancelled: true });
  });

  test('a normal end is terminal without the cancelled flag', () => {
    const frame = turnEndFrame({ stopReason: 'end_turn' });
    expect(frame.isTerminal).toBe(true);
    expect(frame.cancelled).toBeUndefined();
  });
});

describe('acp mapper helpers', () => {
  test('both measured content shapes yield text', () => {
    expect(acpContentText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])).toBe('a\nb');
    expect(acpContentText([{ type: 'content', content: { type: 'text', text: 'wrapped' } }])).toBe('wrapped');
    expect(acpContentText('plain')).toBe('plain');
  });

  test('rawOutput keeps omp-shaped fallbacks', () => {
    expect(acpToolOutput({ content: [{ type: 'text', text: 'x' }] })).toBe('x');
    expect(acpToolOutput({ output: 'y' })).toBe('y');
    expect(acpToolOutput(null)).toBe('');
  });

  test('target prefers locations, then the input bag', () => {
    expect(acpToolTarget([{ path: '/a' }], { path: 'b' })).toBe('/a');
    expect(acpToolTarget(undefined, { command: 'ls -la' })).toBe('ls -la');
    expect(acpToolTarget(undefined, undefined)).toBeUndefined();
  });
});
