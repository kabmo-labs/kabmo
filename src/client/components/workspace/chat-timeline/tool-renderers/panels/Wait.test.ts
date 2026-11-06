/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `wait` card body.
 *
 * What this pins is the answer to one question the generic fallback could not
 * give: how long has this been waiting, and is anything still moving. Before
 * the panel existed a call that can block for minutes rendered as a title and an
 * empty Output block, while `details` already carried every job's status, its
 * elapsed `durationMs` and a subagent's `completionPercent`.
 *
 * The progress bar's honesty is the load-bearing part: a `bash` job reports NO
 * completion percentage, so the bar must sweep rather than claim a position,
 * and a settled call must draw no animation at all.
 *
 * Rendered with `h()` against happy-dom, following `panels/Proc.test.ts`.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { installWaitDom, mountWait as mount, restoreWaitDom, waitBar as bar } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/wait-test-util';
import type { ToolCallData } from '@/shared/types';

beforeAll(installWaitDom);
afterAll(restoreWaitDom);

/** A blocking wait: one bash job with no percentage, one task with one. */
const BLOCKING: Partial<ToolCallData> & Pick<ToolCallData, 'type'> = {
  type: 'wait',
  name: 'wait',
  status: 'running',
  output: '',
  details: {
    op: 'wait',
    jobs: [
      { id: 'bg_1', type: 'bash', status: 'running', label: 'bun run e2e.ts', durationMs: 41_500 },
      { id: 'bg_2', type: 'task', status: 'running', label: 'audit', durationMs: 12_000, completionPercent: 40 },
    ],
  },
};

describe('Wait panel — a blocking call', () => {
  test('shows the elapsed clock the snapshot reports', async () => {
    const el = await mount(BLOCKING);
    // 41.5s is the longest job span, which IS how long the call has blocked.
    expect(el.textContent ?? '').toContain('0:41');
    expect(el.textContent ?? '').toContain('waiting');
  });

  test('lists each job with its status and its own span', async () => {
    const el = await mount(BLOCKING);
    const text = el.textContent ?? '';
    expect(text).toContain('bg_1');
    expect(text).toContain('bun run e2e.ts');
    expect(text).toContain('bg_2');
    expect(text).toContain('running');
    // A subagent's own estimate is shown as a number on its row.
    expect(text).toContain('40%');
  });

  test('sweeps when no job reports a percentage, instead of claiming one', async () => {
    const el = await mount(BLOCKING);
    const track = bar(el);
    expect(track).not.toBeNull();
    // A subagent estimate exists here, so the bar has a real number.
    expect(track?.getAttribute('aria-valuenow')).toBe('40');
    expect(track?.querySelector('.wait-bar-sweep')).toBeNull();
  });

  test('a bash-only wait has no number to show, so the bar is indeterminate', async () => {
    // This is the common case: a `bash` job reports duration but never a
    // completion percentage. A fabricated 50% would be unverifiable.
    const el = await mount({
      ...BLOCKING,
      details: { op: 'wait', jobs: [{ id: 'bg_1', type: 'bash', status: 'running', label: 'bun run e2e.ts', durationMs: 41_500 }] },
    });
    const track = bar(el);
    expect(track?.getAttribute('aria-valuenow')).toBeNull();
    expect(track?.querySelector('.wait-bar-sweep')).not.toBeNull();
  });

  test('counts from the CALL start, never from a watched job’s age', async () => {
    // Measured on a real result: `bg_8` had run 126 s while the `wait` call that
    // watched it took 20 s. A job routinely starts before the wait does, so a
    // clock read off the job would report a wait five times longer than it was.
    const el = await mount({
      type: 'wait',
      name: 'wait',
      status: 'running',
      startedAt: Date.now() - 5_000,
      details: {
        op: 'wait',
        jobs: [{ id: 'bg_8', type: 'bash', status: 'running', label: 'restart loop', durationMs: 126_589 }],
      },
    });
    // The stopwatch is the big mono line; the job row keeps its OWN age, which
    // is a different and equally true number.
    const clock = el.querySelector('.text-\\[22px\\]')?.textContent;
    expect(clock).toBe('0:05');
    expect(el.textContent ?? '').toContain('2:06');
  });
});

describe('Wait panel — running-task telemetry', () => {
  // omp 18.13.0 lifts a task's `requests`, `cost`, context fill and `stage`
  // into the job snapshot, which is what makes omp's own row read
  // `90 req · $18.40 · ctx 160K/1M · stage: implementing`. The card has to draw
  // them, or the telemetry reaches the wire and goes nowhere.
  const TELEMETRY: Partial<ToolCallData> & Pick<ToolCallData, 'type'> = {
    type: 'wait',
    name: 'wait',
    status: 'running',
    output: '',
    details: {
      op: 'wait',
      jobs: [{
        id: 'bg_3', type: 'task', status: 'running', label: 'refactor', durationMs: 18_446_000,
        completionPercent: 55, requests: 90, cost: 18.4,
        contextTokens: 163_840, contextWindow: 1_048_576, stage: 'implementing',
      }],
    },
  };

  test('draws the telemetry line under the row', async () => {
    const el = await mount(TELEMETRY);
    const text = el.textContent ?? '';
    expect(text).toContain('90 req');
    expect(text).toContain('$18.40');
    expect(text).toContain('ctx 163.8K/1.0M');
    expect(text).toContain('stage: implementing');
  });

  test('the percent stays on the row and out of the telemetry line', async () => {
    // The row already shows `55%` as its own chip, so the line must not repeat
    // it — twice would read as a second estimate.
    const el = await mount(TELEMETRY);
    const line = [...el.querySelectorAll('.font-mono')].map((node) => node.textContent ?? '').find((t) => t.includes('req'));
    expect(line?.includes('~55%')).toBe(false);
  });

  test('a settled job draws no telemetry, so a stored snapshot never looks live', async () => {
    const el = await mount({
      ...TELEMETRY,
      status: 'success',
      durationMs: 18_446_000,
      details: {
        op: 'wait',
        jobs: [{ ...TELEMETRY.details!.jobs[0], status: 'completed', exitCode: 0 }],
      },
    });
    expect(el.textContent ?? '').not.toContain('req');
  });
});

describe('Wait panel — an idle return', () => {
  test('a blocking wait claims no ceiling, because omp 18.17.0 has none', async () => {
    // The card used to count down to a 30-minute cap. That cap is gone: a wait
    // returns when a window from the 5 s → 5 min ladder elapses, and the ladder
    // climbs across back-to-back idle waits, so any countdown was a budget omp
    // no longer has.
    const el = await mount({
      ...BLOCKING,
      startedAt: Date.now() - 60_000,
      details: { op: 'wait', jobs: [{ id: 'bg_1', type: 'bash', status: 'running', label: 'bun run e2e.ts', durationMs: 60_000 }] },
    });
    const text = el.textContent ?? '';
    expect(text).toContain('1:00');
    expect(text).not.toContain('left of');
    expect(text).not.toContain('30:00');
  });

  test('names the window omp gave up after, not “no jobs”', async () => {
    // The idle return answers `{op:'wait', jobs:[]}` — the same shape a service
    // wake returns — so omp's own sentence is the only thing that tells them
    // apart. Reading it as "no jobs" says the call looked and found none rather
    // than that its window elapsed.
    const el = await mount({
      type: 'wait',
      name: 'wait',
      status: 'success',
      durationMs: 5_000,
      output: 'No reply within 5.0s.\n\n<system-notice>Nothing new after 15.0s of back-to-back waits. …</system-notice>',
      details: { op: 'wait', jobs: [] },
    });
    const text = el.textContent ?? '';
    expect(text).toContain('idle 15s total');
    expect(text).not.toContain('no jobs');
  });

  test('a service wake is not an idle return', async () => {
    const el = await mount({
      type: 'wait',
      name: 'wait',
      status: 'success',
      durationMs: 4_000,
      output: 'A service finished. Read proc:// for its status and output.',
      details: { op: 'wait', jobs: [] },
    });
    const text = el.textContent ?? '';
    expect(text).not.toContain('idle');
    expect(text).not.toContain('no jobs');
  });
});

describe('Wait panel — a settled call', () => {
  const SETTLED: Partial<ToolCallData> & Pick<ToolCallData, 'type'> = {
    type: 'wait',
    name: 'wait',
    status: 'success',
    durationMs: 126_589,
    output: '## Completed (1)\n\n### bg_8 [bash] — completed',
    details: {
      op: 'wait',
      jobs: [{ id: 'bg_8', type: 'bash', status: 'completed', label: 'restart loop', durationMs: 126_589, exitCode: 0 }],
    },
  };

  test('shows the span it waited, from the job snapshot', async () => {
    const el = await mount(SETTLED);
    expect(el.textContent ?? '').toContain('2:06');
    expect(el.textContent ?? '').toContain('waited');
  });

  test('falls back to the measured call span when the snapshot carries none', async () => {
    // A service wake answers `{op:'wait', jobs:[]}` — no job, so no snapshot
    // span. The fold's own start→end measurement is the only clock there is.
    const el = await mount({ ...SETTLED, details: { op: 'wait', jobs: [] } });
    expect(el.textContent ?? '').toContain('2:06');
  });

  test('draws no animation over a finished call', async () => {
    const el = await mount(SETTLED);
    expect(bar(el)?.querySelector('.wait-bar-sweep')).toBeNull();
    expect(el.textContent ?? '').not.toContain('waiting');
  });

  test('keeps the prose omp wrote, which is the only record of a refusal', async () => {
    const el = await mount({ ...SETTLED, output: 'Nothing to wait for: no background job or service you started is running.' });
    expect(el.textContent ?? '').toContain('Nothing to wait for');
  });
});

describe('Wait panel — interrupted and messaged', () => {
  test('an interrupted wait says so and shows no fake job', async () => {
    const el = await mount({
      type: 'wait',
      name: 'wait',
      status: 'success',
      durationMs: 3_000,
      details: { op: 'wait', jobs: [], interrupted: true },
    });
    const text = el.textContent ?? '';
    expect(text).toContain('interrupted');
    expect(text).not.toContain('Jobs');
  });

  test('every message a wake carried is rendered, oldest first', async () => {
    // omp 18.17.0: one wake returns every message queued by then.
    const el = await mount({
      type: 'wait',
      name: 'wait',
      status: 'success',
      details: {
        op: 'wait',
        from: 'main',
        waited: [
          { from: 'Sleeper', to: 'main', body: 'sleeper reporting in', ts: 1 },
          { from: 'Scout', to: 'main', body: 'map is ready', ts: 2 },
        ],
      },
    });
    const blocks = [...el.querySelectorAll('.whitespace-pre-wrap')].map((node) => node.textContent ?? '');
    expect(el.textContent ?? '').toContain('2 messages');
    expect(blocks).toEqual(['sleeper reporting in', 'map is ready']);
  });

  test('a peer message that woke the wait is rendered with its sender', async () => {
    const el = await mount({
      type: 'wait',
      name: 'wait',
      status: 'success',
      details: {
        op: 'wait',
        from: 'main',
        waited: [{ from: 'Sleeper', to: 'main', body: 'sleeper reporting in', ts: 1_791_000_000_000 }],
      },
    });
    const text = el.textContent ?? '';
    expect(text).toContain('Sleeper');
    expect(text).toContain('sleeper reporting in');
  });

  test('leads a job row with the intent omp 18.15.0 records', async () => {
    const el = await mount({
      type: 'wait',
      name: 'wait',
      status: 'running',
      details: {
        op: 'wait',
        jobs: [
          { id: 'bg_1', type: 'bash', status: 'running', label: 'bun run dev', intent: 'Start the dev server', durationMs: 4_000 },
        ],
      },
    });
    const text = el.textContent ?? '';
    expect(text).toContain('Start the dev server');
    expect(text).toContain('bun run dev');
    // The purpose is the row's subject: it comes BEFORE the raw command.
    expect(text.indexOf('Start the dev server')).toBeLessThan(text.indexOf('bun run dev'));
  });

  test('a task job without an intent still draws its label', async () => {
    const el = await mount({
      type: 'wait',
      name: 'wait',
      status: 'running',
      details: { op: 'wait', jobs: [{ id: 'bg_2', type: 'task', status: 'running', label: 'audit', durationMs: 2_000 }] },
    });
    expect(el.textContent ?? '').toContain('audit');
  });
});
