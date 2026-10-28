/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The collapsed card's line for a `wait` call.
 *
 * Split from `summary.test.ts` (which is at the repo's size ceiling) but the
 * same contract: the chips answer "how long, and is anything still moving".
 * The duration is the load-bearing fact — omp reports no span on the result, so
 * the value comes from the snapshot's job `durationMs` while the call blocks and
 * from the fold's own measurement once it settles.
 *
 * Pure function, no mounting.
 */

import { describe, expect, test } from 'bun:test';
import { toolSummary } from '@/shared/lib/chat/tool/summary';
import type { ToolCallData } from '@/shared/types/chat';

function tool(partial: Partial<ToolCallData> & Pick<ToolCallData, 'type'>): ToolCallData {
  return { id: 'c1', name: partial.type, title: partial.type, ...partial } as ToolCallData;
}

describe('toolSummary — wait', () => {
  test('leads with the clock, then what it watched', () => {
    const summary = toolSummary(tool({
      type: 'wait',
      details: {
        op: 'wait',
        jobs: [
          { id: 'bg_1', type: 'bash', status: 'running', durationMs: 41_500 },
          { id: 'bg_2', type: 'task', status: 'running', durationMs: 12_000 },
        ],
      },
    }));
    expect(summary?.line).toBe('42s · 2 jobs · 2 running');
  });

  test('names a settled failure instead of hiding it behind the count', () => {
    const summary = toolSummary(tool({
      type: 'wait',
      details: { op: 'wait', jobs: [{ id: 'bg_1', status: 'failed', durationMs: 3_000 }] },
    }));
    expect(summary?.line).toBe('3.0s · 1 job · 1 failed');
  });

  test('an interrupted wait says so', () => {
    const summary = toolSummary(tool({
      type: 'wait',
      durationMs: 2_400,
      details: { op: 'wait', jobs: [], interrupted: true },
    }));
    expect(summary?.line).toBe('2.4s · interrupted');
  });

  test('a peer message that woke it is named', () => {
    const summary = toolSummary(tool({
      type: 'wait',
      durationMs: 900,
      details: { op: 'wait', from: 'main', waited: { from: 'Sleeper', body: 'done' } },
    }));
    expect(summary?.line).toBe('900ms · message received');
  });

  test('falls back to the measured call span when no job reports one', () => {
    // A service wake answers `{op:'wait', jobs:[]}` — no snapshot span exists,
    // so the fold's start→end measurement is the only clock there is.
    const summary = toolSummary(tool({ type: 'wait', durationMs: 126_589, details: { op: 'wait', jobs: [] } }));
    expect(summary?.line).toBe('2m 6s · no jobs');
  });

  test('a capped wait says so instead of “no jobs”', () => {
    // The cap and a service wake share `{op:'wait', jobs:[]}`; only the prose
    // separates them, and the chip has to carry that distinction.
    const summary = toolSummary(tool({
      type: 'wait',
      durationMs: 1_800_000,
      output: 'Wait limit reached; background work may still be running.',
      details: { op: 'wait', jobs: [] },
    }));
    expect(summary?.line).toBe('30m 0s · 30m limit reached');
  });

  test('an unreadable result keeps the generic fallback', () => {
    // No `details.op`, so this is not a wait result at all — the output's first
    // line is the only thing worth saying.
    const summary = toolSummary(tool({ type: 'wait', output: 'Nothing to wait for.' }));
    expect(summary?.facts[0]).toMatchObject({ kind: 'subject', label: 'Nothing to wait for.' });
  });
});
