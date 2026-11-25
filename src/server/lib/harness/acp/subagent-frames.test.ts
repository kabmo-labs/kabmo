/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The frames one subagent record becomes.
 *
 * These are the rules the timeline depends on: a child's FIRST frame opens a
 * row, later ones patch it, and a finished child CLOSES the card — an open
 * `task` card spins forever and nothing else will ever end it.
 */

import { describe, expect, test } from 'bun:test';
import { AcpSubagents, subagentCardStatus } from '@/server/lib/harness/acp/subagents';
import { subagentFrames, subagentRowId, subagentToolCallId } from '@/server/lib/harness/acp/subagent-frames';

function recordOf(fields: Record<string, unknown>) {
  const subagents = new AcpSubagents();
  subagents.apply({ sessionId: 'child-1', title: 'Investigator', ...fields });
  return subagents.get('child-1')!;
}

describe('ACP subagent card frames', () => {
  test('the first frame opens a row and starts a task card', () => {
    const record = recordOf({ state: { state: 'running' } });
    const frames = subagentFrames(record, null);
    expect(frames.map((frame) => frame.type)).toEqual([
      'message_start',
      'tool_execution_start',
      'tool_execution_update',
    ]);
    expect(frames[0]?.message).toMatchObject({
      role: 'assistant',
      id: subagentRowId('child-1'),
      content: [{ type: 'toolCall', id: subagentToolCallId('child-1'), name: 'task' }],
    });
    expect(frames[1]).toMatchObject({
      toolCallId: subagentToolCallId('child-1'),
      toolName: 'task',
      intent: 'Investigator',
    });
  });

  test('a later update patches the row instead of opening another', () => {
    const record = recordOf({ state: { state: 'running' } });
    const frames = subagentFrames(record, subagentCardStatus(record));
    expect(frames.map((frame) => frame.type)).toEqual(['message_update', 'tool_execution_update']);
  });

  test('a finished child closes its card and carries its state as the body', () => {
    const subagents = new AcpSubagents();
    subagents.apply({ sessionId: 'child-1', title: 'Investigator', description: 'Checks the build' });
    subagents.absorb('child-1', { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'All green' } });
    subagents.absorb('child-1', { sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' });
    const record = subagents.get('child-1')!;
    const frames = subagentFrames(record, 'running');

    expect(frames.map((frame) => frame.type)).toEqual([
      'message_update',
      'tool_execution_end',
      'message_end',
    ]);
    const end = frames[1]!;
    expect(end.isError).toBe(false);
    expect(String(end.output)).toContain('All green');
    expect(String(end.output)).toContain('State: idle (end_turn)');
  });

  test('a failed child is an error card, not a success with a note', () => {
    const subagents = new AcpSubagents();
    subagents.apply({ sessionId: 'child-1' });
    subagents.absorb('child-1', {
      sessionUpdate: 'state_update',
      state: 'idle',
      stopReason: 'error',
      error: { message: 'provider refused' },
    });
    const frames = subagentFrames(subagents.get('child-1')!, 'running');
    expect(frames.find((frame) => frame.type === 'tool_execution_end')?.isError).toBe(true);
  });
});
