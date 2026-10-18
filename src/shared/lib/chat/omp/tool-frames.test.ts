/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The three tool-execution frames, folded into one record.
 *
 * The span is the reason this file exists: omp reports NO duration on either
 * frame — `tool_execution_end` carries the result and its `details`, never a
 * span — so a `wait` that blocked for two minutes read exactly like one that
 * returned instantly. The start clock is opened by `tool_execution_start` and
 * closed by the end frame, and every writer in between must carry it forward
 * rather than replace it.
 *
 * The progress snapshot is the second half: `wait` re-emits its whole state
 * every 500 ms while it blocks, and those `details` are the only live progress
 * such a call has.
 */

import { describe, expect, test } from 'bun:test';
import type { ChatMessageData } from '@/shared/types';
import type { OmpAgentFoldDeps } from '@/shared/lib/chat/omp/fold-deps';
import { foldToolEnd, foldToolStart, foldToolUpdate } from '@/shared/lib/chat/omp/tool-frames';

function makeDeps() {
  const updates: ChatMessageData[] = [];
  const deps = {
    sessionId: 's1',
    setState: () => {},
    callbacksRef: { current: { onMessageUpdate: (msg: ChatMessageData) => updates.push(msg) } },
    toolResultsRef: { current: new Map() },
    lastToolMessageRef: {
      current: {
        id: 'm1',
        role: 'ai',
        content: '',
        toolCalls: [{ id: 'c1', type: 'wait', title: 'Wait', status: 'running' }],
      } as ChatMessageData,
    },
    activityRef: { current: '' },
    providerRetryVerbRef: { current: null },
    currentThinkingLevelRef: { current: undefined },
  };
  return { deps: deps as unknown as OmpAgentFoldDeps, updates };
}

describe('foldToolStart', () => {
  test('opens the span and marks the call running', () => {
    const { deps, updates } = makeDeps();
    foldToolStart({ toolCallId: 'c1', toolName: 'wait', args: {} }, deps);
    expect(typeof deps.toolResultsRef.current?.get('c1')?.startedAt).toBe('number');
    expect(updates.at(-1)?.toolCalls?.[0]?.status).toBe('running');
  });
});

describe('foldToolUpdate', () => {
  test('keeps the progress details a blocking tool reports', () => {
    const { deps } = makeDeps();
    foldToolUpdate({
      toolCallId: 'c1',
      toolName: 'wait',
      partialResult: {
        content: [{ type: 'text', text: '' }],
        details: { op: 'wait', jobs: [{ id: 'bg_1', status: 'running', durationMs: 41_500 }] },
      },
    }, deps);
    expect(deps.toolResultsRef.current?.get('c1')?.details).toEqual({
      op: 'wait',
      jobs: [{ id: 'bg_1', status: 'running', durationMs: 41_500 }],
    });
  });

  test('a frame with no details keeps the previous snapshot', () => {
    // The write REPLACES the record, so an absent bag would erase what the last
    // progress frame said and blank the card mid-wait.
    const { deps } = makeDeps();
    foldToolUpdate({
      toolCallId: 'c1',
      partialResult: { content: [{ type: 'text', text: 'working' }], details: { op: 'wait', jobs: [{ id: 'bg_1' }] } },
    }, deps);
    foldToolUpdate({
      toolCallId: 'c1',
      partialResult: { content: [{ type: 'text', text: 'working more' }] },
    }, deps);
    expect(deps.toolResultsRef.current?.get('c1')?.details).toEqual({ op: 'wait', jobs: [{ id: 'bg_1' }] });
    expect(deps.toolResultsRef.current?.get('c1')?.output).toBe('working more');
  });

  test('an empty text snapshot does not erase the output already stored', () => {
    const { deps } = makeDeps();
    foldToolUpdate({ toolCallId: 'c1', partialResult: { content: [{ type: 'text', text: 'progress' }] } }, deps);
    foldToolUpdate({ toolCallId: 'c1', partialResult: { content: [] } }, deps);
    expect(deps.toolResultsRef.current?.get('c1')?.output).toBe('progress');
  });
});

describe('a call that has not finished', () => {
  test('a start or progress frame keeps the card RUNNING, never Done', () => {
    // The map holds an entry from `tool_execution_start` onward, so "an entry
    // exists" is not "the call returned". `pairToolOutputs` used to read it that
    // way and settled the card on its FIRST update — measured in a browser spec:
    // a `wait` blocking for 4 s rendered as `Done` with a 0:00 clock the moment
    // omp sent its first snapshot, so the panel never showed a live state.
    const { deps, updates } = makeDeps();
    foldToolStart({ toolCallId: 'c1', toolName: 'wait', args: {} }, deps);
    expect(updates.at(-1)?.toolCalls?.[0]?.status).toBe('running');

    foldToolUpdate({ toolCallId: 'c1', partialResult: { content: [{ type: 'text', text: '' }], details: { op: 'wait', jobs: [] } } }, deps);
    expect(updates.at(-1)?.toolCalls?.[0]?.status).toBe('running');
  });

  test('the end frame settles it', () => {
    const { deps, updates } = makeDeps();
    foldToolStart({ toolCallId: 'c1', toolName: 'wait', args: {} }, deps);
    foldToolUpdate({ toolCallId: 'c1', partialResult: { content: [{ type: 'text', text: 'x' }] } }, deps);
    foldToolEnd({ toolCallId: 'c1', result: { content: [{ type: 'text', text: 'done' }] } }, deps);
    expect(updates.at(-1)?.toolCalls?.[0]?.status).toBe('success');
  });
});

describe('foldToolEnd', () => {
  test('closes the span the start frame opened and puts it on the card', () => {
    const { deps, updates } = makeDeps();
    foldToolStart({ toolCallId: 'c1', toolName: 'wait', args: {} }, deps);
    foldToolEnd({ toolCallId: 'c1', result: { content: [{ type: 'text', text: 'done' }] } }, deps);

    const record = deps.toolResultsRef.current?.get('c1');
    expect(typeof record?.durationMs).toBe('number');
    expect(record?.durationMs).toBeGreaterThanOrEqual(0);
    // …and the span reaches the call, which is what the card and its chips read.
    expect(updates.at(-1)?.toolCalls?.[0]?.durationMs).toBe(record?.durationMs);
  });

  test('a call whose start frame was missed reports no fabricated span', () => {
    const { deps } = makeDeps();
    foldToolEnd({ toolCallId: 'c1', result: { content: [{ type: 'text', text: 'done' }] } }, deps);
    expect(deps.toolResultsRef.current?.get('c1')?.durationMs).toBeUndefined();
  });
});
