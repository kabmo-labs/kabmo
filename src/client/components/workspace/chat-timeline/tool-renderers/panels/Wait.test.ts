/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The `wait` card body.
 *
 * What this pins is the answer to one question the generic fallback could not
 * give: how long has this been waiting, and is anything still moving. Before
 * the panel existed a call that can block for 30 minutes rendered as a title
 * and an empty Output block, while `details` already carried every job's
 * status, its elapsed `durationMs` and a subagent's `completionPercent`.
 *
 * The progress bar's honesty is the load-bearing part: a `bash` job reports NO
 * completion percentage, so the bar must sweep rather than claim a position,
 * and a settled call must draw no animation at all.
 *
 * Rendered with `h()` against happy-dom, following `panels/Proc.test.ts`.
 */

import { afterAll, beforeAll, describe, expect, setSystemTime, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { Wait } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/Wait';
import { WAIT_MAX_MS } from '@/shared/lib/omp/session/wait';
import type { ToolCallData } from '@/shared/types';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let container: HTMLElement;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
});

async function mount(partial: Partial<ToolCallData> & Pick<ToolCallData, 'type'>) {
  const tool = { id: 'c1', name: partial.type, title: partial.type, ...partial } as ToolCallData;
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(Wait, { tool }), container);
  });
  return container;
}

function bar(el: HTMLElement): HTMLElement | null {
  return el.querySelector('[role="progressbar"]');
}

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

describe('Wait panel — the 30-minute cap', () => {
  test('states the ceiling and the remaining budget while blocking', async () => {
    // omp caps one `wait` at 30 minutes and takes no argument to raise it, so
    // the ceiling belongs on the card: without it "still waiting" and "waiting
    // for something that can never arrive" look the same.
    //
    // A FROZEN clock, not a start value chosen to be safe. The panel counts
    // `now - startedAt`, so a real clock makes the rendered figure a function of
    // how long the mount took: `Date.now() - 60_000` reads `28:59` a few
    // milliseconds later and failed on every run (measured on both CI legs:
    // expected "29:00", received "28:59"). Pinning `Date.now` to one instant
    // makes the budget exact.
    const now = Date.now();
    setSystemTime(new Date(now));
    try {
      const el = await mount({
        ...BLOCKING,
        startedAt: now - 60_000,
        details: { op: 'wait', jobs: [{ id: 'bg_1', type: 'bash', status: 'running', label: 'bun run e2e.ts', durationMs: 60_000 }] },
      });
      const text = el.textContent ?? '';
      expect(text).toContain('29:00 left of 30:00');
    } finally {
      setSystemTime();
    }
  });

  test('a capped wait is named as such, not as “no jobs”', async () => {
    // The cap answers `{op:'wait', jobs:[]}` — the same shape a service wake
    // returns — so the prose is the only thing that tells them apart. Reading it
    // as "no jobs" says the call found nothing rather than that it ran out of
    // time.
    const el = await mount({
      type: 'wait',
      name: 'wait',
      status: 'success',
      durationMs: WAIT_MAX_MS,
      output: 'Wait limit reached; background work may still be running. Read proc:// for status.',
      details: { op: 'wait', jobs: [] },
    });
    const text = el.textContent ?? '';
    expect(text).toContain('limit reached');
    expect(text).toContain('Wait limit reached');
  });

  test('a service wake is not reported as the cap', async () => {
    const el = await mount({
      type: 'wait',
      name: 'wait',
      status: 'success',
      durationMs: 4_000,
      output: 'A service finished. Read proc:// for its status and output.',
      details: { op: 'wait', jobs: [] },
    });
    expect(el.textContent ?? '').not.toContain('limit reached');
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

  test('keeps the prose omp wrote, which is the only record of a cap or a refusal', async () => {
    const el = await mount({ ...SETTLED, output: 'Wait limit reached; background work may still be running.' });
    expect(el.textContent ?? '').toContain('Wait limit reached');
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

  test('a peer message that woke the wait is rendered with its sender', async () => {
    const el = await mount({
      type: 'wait',
      name: 'wait',
      status: 'success',
      details: {
        op: 'wait',
        from: 'main',
        waited: { from: 'Sleeper', to: 'main', body: 'sleeper reporting in', ts: 1_791_000_000_000 },
      },
    });
    const text = el.textContent ?? '';
    expect(text).toContain('Sleeper');
    expect(text).toContain('sleeper reporting in');
  });
});

describe('Wait panel — not a wait', () => {
  test('falls back to the plain output for a result it cannot read', async () => {
    const el = await mount({ type: 'wait', name: 'wait', status: 'success', output: 'Nothing to wait for.', details: {} });
    expect(el.textContent ?? '').toContain('Nothing to wait for.');
    expect(bar(el)).toBeNull();
  });
});
