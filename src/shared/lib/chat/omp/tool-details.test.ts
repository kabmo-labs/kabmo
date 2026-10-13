/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The tool result's `details` on the LIVE fold.
 *
 * omp nests a tool result's `details` INSIDE `result` on its live frames — its
 * own wire schema declares `ToolExecutionEndEvent` with only
 * `type/toolCallId/toolName/result/isError`, and `details` lives on the
 * `ToolResultMessage` that `result` mirrors. A `message_end` toolResult carries
 * them at the TOP level instead. Reading only the top level dropped every live
 * card's facts (`wallTimeMs`, `exitCode`, `service`, the `diff`, `phases`, …):
 * the card that had just streamed showed a bare output line while a reload
 * showed the real chips. The frames below are verbatim from omp 18.10.3.
 */

import { describe, expect, test } from 'bun:test';

import type { ChatMessageData, OmpAgentCallbacks, OmpAgentState } from '@/shared/types';
import { foldAgentEvent, type OmpAgentFoldDeps } from '@/shared/lib/chat/omp/agent-events';

/** The assistant turn that carries the tool call — the row the card lives on. */
const CALL_MSG = {
  role: 'assistant',
  id: 'm1',
  content: [{ type: 'toolCall', id: 'c1', name: 'bash', arguments: { command: 'echo hi' } }],
};

function makeDeps() {
  const updates: ChatMessageData[] = [];
  const callbacks: OmpAgentCallbacks = { onMessageUpdate: (msg) => updates.push(msg) };
  let state: OmpAgentState = { isGenerating: false, connected: true, error: null };
  const deps: OmpAgentFoldDeps = {
    sessionId: 's1',
    setState: (update) => {
      state = typeof update === 'function' ? update(state) : update;
    },
    callbacksRef: { current: callbacks },
    toolResultsRef: { current: new Map() },
    lastToolMessageRef: { current: null },
    activityRef: { current: '' },
    providerRetryVerbRef: { current: null },
    currentThinkingLevelRef: { current: undefined },
  };
  return { deps, updates };
}

describe('foldAgentEvent tool details', () => {
  test('pairs details nested in `result` onto the live card', () => {
    const { deps, updates } = makeDeps();
    foldAgentEvent({ type: 'message_end', message: CALL_MSG }, deps);
    foldAgentEvent({
      type: 'tool_execution_end',
      toolCallId: 'c1',
      toolName: 'bash',
      result: {
        content: [{ type: 'text', text: 'hello-world\n' }],
        details: { wallTimeMs: 85.48, timeoutSeconds: 300, exitCode: 0 },
      },
      isError: false,
    }, deps);

    expect(updates.at(-1)?.toolCalls?.[0]?.details).toEqual({ wallTimeMs: 85.48, timeoutSeconds: 300, exitCode: 0 });
  });

  test('still reads a top-level `details` (a build that sends it there)', () => {
    const { deps, updates } = makeDeps();
    foldAgentEvent({ type: 'message_end', message: CALL_MSG }, deps);
    foldAgentEvent({
      type: 'tool_execution_end',
      toolCallId: 'c1',
      details: { exitCode: 1 },
      result: { content: [{ type: 'text', text: 'boom' }] },
      isError: true,
    }, deps);

    expect(updates.at(-1)?.toolCalls?.[0]?.details).toEqual({ exitCode: 1 });
  });

  test('a nested result wins over a top-level bag', () => {
    const { deps, updates } = makeDeps();
    foldAgentEvent({ type: 'message_end', message: CALL_MSG }, deps);
    foldAgentEvent({
      type: 'tool_execution_end',
      toolCallId: 'c1',
      details: { from: 'top' },
      result: { content: [], details: { from: 'result' } },
    }, deps);

    expect(updates.at(-1)?.toolCalls?.[0]?.details).toEqual({ from: 'result' });
  });

  test('a toolResult `message_end` re-pairs the card it belongs to', () => {
    // The frame omp sends after `tool_execution_end`; a result arriving first
    // (or an `_end` frame that carried no details) must still reach the row.
    const { deps, updates } = makeDeps();
    foldAgentEvent({ type: 'message_end', message: CALL_MSG }, deps);
    foldAgentEvent({
      type: 'message_end',
      message: {
        role: 'toolResult',
        toolCallId: 'c1',
        toolName: 'bash',
        content: [{ type: 'text', text: 'hi\n' }],
        details: { wallTimeMs: 61.6 },
        isError: false,
      },
    }, deps);

    const paired = updates.at(-1)?.toolCalls?.[0];
    expect(paired?.details).toEqual({ wallTimeMs: 61.6 });
    expect(paired?.status).toBe('success');
  });

  test('an error toolResult pairs as an error', () => {
    const { deps, updates } = makeDeps();
    foldAgentEvent({ type: 'message_end', message: CALL_MSG }, deps);
    foldAgentEvent({
      type: 'message_end',
      message: {
        role: 'toolResult',
        toolCallId: 'c1',
        toolName: 'bash',
        content: [{ type: 'text', text: 'boom' }],
        details: { exitCode: 1 },
        isError: true,
      },
    }, deps);

    expect(updates.at(-1)?.toolCalls?.[0]?.status).toBe('error');
  });
});
