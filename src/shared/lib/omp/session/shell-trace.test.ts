/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The shell trace omp 18.17.0 attaches to every `bash` frame, and the two
 * places Kabmo drops it: the live frame boundary and the transcript reload.
 *
 * Measured on 18.17.0: a 40-line command carried 192 KB of frames (19 KB on
 * 18.16.0), a 40 000-line one 1.15 MB, and `seq 1 30000` left a 201 KB trace in
 * the session JSONL — a second copy of the output, under `history`.
 */

import { describe, expect, test } from 'bun:test';
import { stripShellTrace, withoutShellTrace } from '@/shared/lib/omp/session/shell-trace';

const TRACE = { v: 1, seq: 29, status: 0, script: 'seq 1 3', units: [], history: [{ kind: 'RunStart' }] };

describe('withoutShellTrace', () => {
  test('drops the trace and keeps every other field', () => {
    const details: { wallTimeMs: number; meta: Record<string, unknown>; trace?: unknown } = {
      wallTimeMs: 12,
      meta: { truncation: { direction: 'middle' } },
      trace: TRACE,
    };
    const lean = withoutShellTrace(details);
    expect(lean).toEqual({ wallTimeMs: 12, meta: { truncation: { direction: 'middle' } } });
    expect('trace' in lean).toBe(false);
  });

  test('returns the SAME reference when there is nothing to drop', () => {
    // Every tool but a live `bash` takes this path, so it must not allocate.
    const details = { wallTimeMs: 12 };
    expect(withoutShellTrace(details)).toBe(details);
    expect(withoutShellTrace(undefined)).toBeUndefined();
  });

  test('leaves a non-object details bag alone', () => {
    expect(withoutShellTrace('text')).toBe('text');
  });
});

describe('stripShellTrace', () => {
  test('drops the trace from a progress frame', () => {
    const frame = { type: 'tool_execution_update', partialResult: { content: [], details: { trace: TRACE } as Record<string, unknown> } };
    stripShellTrace(frame);
    expect(frame.partialResult.details).toEqual({});
  });

  test('drops it from the end result and from the message that mirrors it', () => {
    const frame = {
      type: 'tool_execution_end',
      result: { content: [], details: { exitCode: 0, trace: TRACE } as Record<string, unknown> },
      message: { role: 'toolResult', details: { exitCode: 0, trace: TRACE } as Record<string, unknown> },
    };
    stripShellTrace(frame);
    expect(frame.result.details).toEqual({ exitCode: 0 });
    expect(frame.message.details).toEqual({ exitCode: 0 });
  });

  test('is a no-op for a frame with no trace or no details', () => {
    const frame = { type: 'agent_start' };
    expect(() => stripShellTrace(frame)).not.toThrow();
    const other = { type: 'tool_execution_end', result: { content: [] } };
    expect(() => stripShellTrace(other)).not.toThrow();
    expect(other).toEqual({ type: 'tool_execution_end', result: { content: [] } });
  });
});
