/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `wait` result normalization and the clock it reports.
 *
 * The fixtures are the shapes omp actually sends (measured on 443 results in
 * the author's session store): a blocking snapshot with running jobs, a
 * settled snapshot with a completion, an interrupted wait with no jobs, a peer
 * message that woke it, and the empty result of an idle window. The empty result
 * is the load-bearing one — it is a real ANSWER ("No reply within 5.0s."), and a
 * reader that treated "no jobs" as "not a wait" drew the most interesting wait
 * of all as a generic card.
 *
 * Pure, no mounting.
 */

import { describe, expect, test } from 'bun:test';
import {
  formatWaitClock,
  waitCounts,
  waitJobSpanMs,
  waitSummaryLine,
  waitViewOf,
} from '@/shared/lib/omp/session/wait';

const BLOCKING = {
  op: 'wait',
  meta: { source: { type: 'report', value: 'background jobs snapshot' } },
  jobs: [
    { id: 'bg_1', type: 'bash', status: 'running', label: 'bun run e2e.ts', durationMs: 41_500 },
    { id: 'bg_2', type: 'task', status: 'running', label: 'audit', durationMs: 12_000, completionPercent: 40, resolvedModel: 'deepseek-v4-1-flash' },
  ],
};

const SETTLED = {
  op: 'wait',
  jobs: [
    { id: 'bg_8', type: 'bash', status: 'completed', label: 'restart loop', durationMs: 126_589, exitCode: 0 },
  ],
};

describe('waitViewOf', () => {
  test('reads a blocking snapshot with its jobs', () => {
    const view = waitViewOf({ details: BLOCKING });
    expect(view?.op).toBe('wait');
    expect(view?.jobs).toHaveLength(2);
    expect(view?.jobs[0]).toMatchObject({ id: 'bg_1', status: 'running', durationMs: 41_500 });
    expect(view?.jobs[1]).toMatchObject({ completionPercent: 40, resolvedModel: 'deepseek-v4-1-flash' });
  });

  test('reads the running-task telemetry omp 18.13.0 adds', () => {
    // omp copies these out of a task's progress record into the job snapshot;
    // they are the numbers behind `90 req · $18.40 · ctx 160K/1M · stage: …`.
    const view = waitViewOf({
      details: {
        op: 'wait',
        jobs: [{
          id: 'bg_3', type: 'task', status: 'running', label: 'refactor', durationMs: 18_446_000,
          completionPercent: 55, requests: 90, cost: 18.4,
          contextTokens: 163_840, contextWindow: 1_048_576, stage: 'implementing',
        }],
      },
    });
    expect(view?.jobs[0]).toMatchObject({
      requests: 90,
      cost: 18.4,
      contextTokens: 163_840,
      contextWindow: 1_048_576,
      stage: 'implementing',
    });
  });

  test('an empty job list is an answer, not an absence', () => {
    // `{op:'wait', jobs:[]}` is what omp returns when the call's idle window
    // elapses, when a SERVICE rather than a job woke the call, and when every
    // agent asked can no longer answer.
    const view = waitViewOf({ details: { op: 'wait', jobs: [] } });
    expect(view?.jobs).toEqual([]);
    expect(view?.interrupted).toBe(false);
  });

  test('reads an interrupted wait', () => {
    const view = waitViewOf({ details: { op: 'wait', jobs: [], interrupted: true } });
    expect(view?.interrupted).toBe(true);
  });

  test('reads the peer messages that ended the wait', () => {
    // omp 18.17.0: a wake returns EVERY message queued by then, oldest first.
    const view = waitViewOf({
      details: {
        op: 'wait',
        from: 'main',
        waited: [
          { from: 'Sleeper', to: 'main', body: 'done', ts: 1_791_000_000_000 },
          { from: 'Scout', to: 'main', body: 'found it', ts: 1_791_000_000_001 },
        ],
      },
    });
    expect(view?.waited).toHaveLength(2);
    expect(view?.waited[0]).toMatchObject({ from: 'Sleeper', body: 'done' });
    expect(view?.waited[1]).toMatchObject({ from: 'Scout', body: 'found it' });
  });

  test('reads the single-message shape a session recorded before 18.17.0 keeps', () => {
    // The JSONL is authoritative for reloads, and the field was an OBJECT until
    // 18.17.0. `isRecord` refuses an array, so the old parser answered undefined
    // — the message block vanished silently on every new wait.
    const view = waitViewOf({
      details: { op: 'wait', from: 'main', waited: { from: 'Sleeper', to: 'main', body: 'done', ts: 1 } },
    });
    expect(view?.waited).toHaveLength(1);
    expect(view?.waited[0]).toMatchObject({ from: 'Sleeper', body: 'done' });
  });

  test('a wait that woke on nothing reports no messages', () => {
    expect(waitViewOf({ details: { op: 'wait', jobs: [] } })?.waited).toEqual([]);
    expect(waitViewOf({ name: 'wait' })?.waited).toEqual([]);
  });

  test('does not claim a proc:// or hub listing', () => {
    // Both carry `jobs`, and `procViewOf` already owns them. Reading them here
    // would draw a process listing as a wait.
    expect(waitViewOf({ details: { op: 'list', jobs: [{ id: 'bg_1' }] } })).toBeUndefined();
    expect(waitViewOf({ details: { jobs: [{ id: 'bg_1' }] } })).toBeUndefined();
    expect(waitViewOf({ details: { proc: { jobs: [{ id: 'bg_1' }] } } })).toBeUndefined();
    expect(waitViewOf({})).toBeUndefined();
  });

  test('a wait with NO result is still a wait, and says its jobs are unknown', () => {
    // The reload case: the transcript holds the `toolCall` block and no
    // `toolResult` behind it. Requiring `details.op` degraded the card to a
    // generic Output block — the reported "wait renders as general after a
    // reload". The name is the only evidence left, and `reported: false` is
    // what keeps a reader from claiming "no jobs".
    const view = waitViewOf({ name: 'wait' });
    expect(view).toMatchObject({ op: 'wait', jobs: [], reported: false });
  });

  test("omp's own `details: {}` answer is unreported, not an empty job list", () => {
    // "Nothing to wait for: no background job or service you started is
    // running." arrives with `details: {}` — a real result, but it carries no
    // snapshot, so the job list is UNKNOWN rather than known-empty.
    const view = waitViewOf({ name: 'wait', details: {} });
    expect(view?.reported).toBe(false);
    expect(view?.jobs).toEqual([]);
  });

  test('a reported snapshot is marked reported', () => {
    expect(waitViewOf({ name: 'wait', details: { op: 'wait', jobs: [] } })?.reported).toBe(true);
  });

  test('another tool with no result is not claimed by its name', () => {
    expect(waitViewOf({ name: 'bash' })).toBeUndefined();
    expect(waitViewOf({ type: 'task' })).toBeUndefined();
  });
});

describe('waitJobSpanMs', () => {
  test('reports the longest span a watched job reports', () => {
    expect(waitJobSpanMs(waitViewOf({ details: BLOCKING })!)).toBe(41_500);
  });

  test('is undefined when no job reports a span', () => {
    expect(waitJobSpanMs(waitViewOf({ details: { op: 'wait', jobs: [] } })!)).toBeUndefined();
  });

  test('is NOT the wait’s own clock — a job can predate the wait', () => {
    // Measured on a real result: `bg_8` had run 126 s while the `wait` call that
    // watched it took 20 s. The call's span is `tool.durationMs`; this helper
    // only reports what the JOB says, and every caller prefers the call's own.
    const view = waitViewOf({ details: { op: 'wait', jobs: [{ id: 'bg_8', status: 'completed', durationMs: 126_589 }] } })!;
    expect(waitJobSpanMs(view)).toBe(126_589);
  });
});

describe('waitCounts and the summary line', () => {
  test('counts running, failed and cancelled separately', () => {
    const view = waitViewOf({
      details: {
        op: 'wait',
        jobs: [
          { status: 'running' },
          { status: 'failed' },
          { status: 'cancelled' },
          { status: 'completed' },
        ],
      },
    })!;
    expect(waitCounts(view)).toEqual({ total: 4, running: 1, failed: 1, cancelled: 1 });
    expect(waitSummaryLine(view)).toBe('4 jobs · 1 running · 1 failed · 1 cancelled');
  });

  test('names a single job in the singular, and says when it was interrupted', () => {
    expect(waitSummaryLine(waitViewOf({ details: SETTLED })!)).toBe('1 job');
    expect(waitSummaryLine(waitViewOf({ details: { op: 'wait', jobs: [], interrupted: true } })!))
      .toBe('interrupted');
  });

  test('an empty result has an empty line, not a fabricated count', () => {
    expect(waitSummaryLine(waitViewOf({ details: { op: 'wait', jobs: [] } })!)).toBe('');
  });
});

describe('formatWaitClock', () => {
  test('keeps a fixed width per scale so the digits do not re-flow', () => {
    expect(formatWaitClock(7_000)).toBe('0:07');
    expect(formatWaitClock(83_000)).toBe('1:23');
    expect(formatWaitClock(3_723_000)).toBe('1:02:03');
  });

  test('clamps a missing or negative span to zero', () => {
    expect(formatWaitClock(-5)).toBe('0:00');
    expect(formatWaitClock(Number.NaN)).toBe('0:00');
  });
});
