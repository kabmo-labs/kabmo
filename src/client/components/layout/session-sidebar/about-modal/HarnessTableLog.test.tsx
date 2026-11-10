/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The row's link to its update log, in the three states a record can be in.
 *
 * A harness update runs in a background worker, so the row can only show *that*
 * something is installing — never what it printed. That output lives in the job
 * record, and these cases pin the row's half of the deal: while the worker runs
 * the row names the step and offers `View log`; a run WAITING behind another one
 * says so instead of claiming to install; once a run settles the row keeps
 * offering the log with the run's own sentence; and a record never leaks onto a
 * row that does not own it.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'preact/test-utils';
import { render } from 'preact';

import {
  harnessRows,
  installHarnessTableDom,
  mountHarnessTable,
  restoreHarnessTableDom,
  summary,
  updateJob,
  version,
} from '@/test-support/harness-table.test-util';

let container: HTMLElement;

beforeAll(() => {
  installHarnessTableDom();
});

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
});

afterAll(() => {
  restoreHarnessTableDom();
});

/** The claude row, with update records attached. */
function mountClaude(state: Parameters<typeof mountHarnessTable>[5]): HTMLElement {
  return mountHarnessTable(
    container,
    [summary()],
    [version({ updateAvailable: true, agent: { version: '0.100.0', latest: '0.102.0', updateAvailable: true } })],
    undefined,
    undefined,
    state,
  );
}

describe('harness row update log', () => {
  test('while the worker runs, the row names the step and offers the log', () => {
    const opened: string[] = [];
    const el = mountClaude({
      jobs: [updateJob()],
      onOpenLog: (harness) => { opened.push(harness); },
    });
    const row = harnessRows(el)[0];
    expect(row.textContent).toContain('Installing adapter…');
    const log = row.querySelector<HTMLButtonElement>('[data-update-log]');
    expect(log?.textContent).toBe('View log');
    act(() => log!.click());
    // The opener names the harness: two records can be on screen at once.
    expect(opened).toEqual(['claude']);
  });

  test('a run waiting behind another one says it is queued, and does not spin', () => {
    const el = mountClaude({
      jobs: [updateJob({ pid: null, queuedAt: Date.now() })],
      onOpenLog: () => {},
    });
    const row = harnessRows(el)[0];
    expect(row.textContent).toContain('Queued — starts when the install running now finishes');
    expect(row.textContent).not.toContain('Installing');
    const button = row.querySelector<HTMLButtonElement>('button[aria-label^="Queued:"]');
    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(true);
  });

  test('after the run settles the log stays, with the run’s sentence', () => {
    const el = mountClaude({
      jobs: [updateJob({
        pid: null,
        finishedAt: Date.now(),
        ok: false,
        applied: true,
        message: 'claude update failed (exit 3)',
        steps: [{ part: 'adapter', command: 'npm install -g x', argv: ['npm'], state: 'failed', code: 3 }],
      })],
      onOpenLog: () => {},
    });
    const row = harnessRows(el)[0];
    expect(row.textContent).toContain('claude update failed (exit 3)');
    expect(row.querySelector('[data-update-log]')).not.toBeNull();
  });

  test('a record for another harness does not appear on this row', () => {
    const el = mountClaude({ jobs: [updateJob({ harness: 'codex', label: 'codex', message: 'codex updated' })] });
    expect(harnessRows(el)[0].querySelector('[data-update-log]')).toBeNull();
  });
});
