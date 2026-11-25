/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The server annotates every live frame's tool blocks, once.
 *
 * This is the boundary that replaced the client's three-way classification:
 * whatever vocabulary an adapter sends (`shell`, `kind:"execute"`, a bare
 * title), the frame that reaches the realtime topic carries one `render` family
 * that every renderer reads. The cases here are the ones that used to disagree.
 */

import { describe, expect, test } from 'bun:test';
import { normalizeAgentEvent } from '@/server/lib/chat/normalize-tools.server';

function frame(name: string | undefined, extra: Record<string, unknown> = {}) {
  return {
    type: 'message_update',
    message: {
      role: 'assistant',
      content: [{
        type: 'toolCall',
        id: 'c1',
        ...(name === undefined ? {} : { name }),
        arguments: { command: 'ls' },
        ...extra,
      }],
    },
  };
}

function firstBlock(event: { message?: unknown }): Record<string, unknown> {
  const message = event.message as { content: Record<string, unknown>[] };
  return message.content[0];
}

describe('normalizeAgentEvent', () => {
  test('annotates an agent-vocabulary name with the family the renderer reads', () => {
    const block = firstBlock(normalizeAgentEvent(frame('shell')));
    expect(block.render).toEqual({ key: 'bash', normalized: true });
  });

  test('falls back to the adapter kind when the name names no panel', () => {
    const block = firstBlock(normalizeAgentEvent(frame(undefined, { toolKind: 'execute' })));
    expect(block.render).toEqual({ key: 'bash', normalized: true });
  });

  test('a call no rule matches is custom, so the client shows JSON', () => {
    const block = firstBlock(normalizeAgentEvent(frame('VendorWidget')));
    expect(block.render).toEqual({ key: 'custom', normalized: false });
  });

  test('a frame with no tool block is returned unchanged', () => {
    const event = { type: 'agent_start' };
    expect(normalizeAgentEvent(event)).toBe(event);
  });

  test('a non-message frame is returned unchanged', () => {
    const event = { type: 'tool_execution_end', toolCallId: 'c1', toolName: 'bash' };
    expect(normalizeAgentEvent(event)).toBe(event);
  });

  test('annotation is idempotent: the same block object is reused', () => {
    const once = normalizeAgentEvent(frame('shell'));
    const block = firstBlock(once);
    const twice = normalizeAgentEvent(once);
    expect(firstBlock(twice)).toBe(block);
  });

  test('a toolResult block is not treated as a call', () => {
    const event = {
      type: 'message_end',
      message: { content: [{ type: 'toolResult', toolCallId: 'c1', text: 'ok' }] },
    };
    expect(normalizeAgentEvent(event)).toBe(event);
  });
});
