/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A reloaded tool call's wall time.
 *
 * omp writes each call's start as its own `custom` entry — the ONLY place a
 * tool's begin time exists in the JSONL — and the `toolResult` entry carries no
 * duration at all. Without the join, a reloaded `wait` knew how long it blocked
 * only from its own output prose (measured: 323 wait results, 114,642 start
 * entries across the author's store).
 *
 * The second test is the honesty rule: a truncated or hand-written session must
 * not fabricate a span it cannot measure.
 */

import { describe, expect, test } from 'bun:test';
import { collectToolOutputs } from '@/shared/lib/omp/session/messages-map';

describe('collectToolOutputs — the span a call took', () => {
  test('times a call from its tool_execution_start entry to its result entry', () => {
    const started = {
      type: 'custom',
      customType: 'tool_execution_start',
      timestamp: '2026-10-12T15:47:35.132Z',
      data: { toolCallId: 'c', toolName: 'wait', startedAt: '2026-10-12T15:47:35.132Z' },
    };
    const ended = {
      type: 'message',
      timestamp: '2026-10-12T15:49:41.721Z',
      message: { role: 'toolResult', toolCallId: 'c', content: [{ type: 'text', text: 'done' }] },
    };
    expect(collectToolOutputs([started, ended]).get('c')?.durationMs).toBe(126_589);
  });

  test('falls back to the entry timestamp when the data carries no startedAt', () => {
    const started = {
      type: 'custom',
      customType: 'tool_execution_start',
      timestamp: '2026-10-12T15:47:35.132Z',
      data: { toolCallId: 'c', toolName: 'wait' },
    };
    const ended = {
      type: 'message',
      timestamp: '2026-10-12T15:47:45.132Z',
      message: { role: 'toolResult', toolCallId: 'c', content: [{ type: 'text', text: 'done' }] },
    };
    expect(collectToolOutputs([started, ended]).get('c')?.durationMs).toBe(10_000);
  });

  test('leaves the span undefined when the start entry is missing', () => {
    const ended = {
      type: 'message',
      timestamp: '2026-10-12T15:47:45.132Z',
      message: { role: 'toolResult', toolCallId: 'c', content: [{ type: 'text', text: 'done' }] },
    };
    expect(collectToolOutputs([ended]).get('c')?.durationMs).toBeUndefined();
  });
});
