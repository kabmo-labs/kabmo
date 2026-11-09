/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The row's link to its update log.
 *
 * A harness update runs in a background worker, so the row can only show *that*
 * something is installing — never what it printed. That output lives in the
 * job record, and these cases pin the row's half of the deal: while the worker
 * runs the row names the step and offers `View log`; once it settles the row
 * keeps offering the log with the run's own sentence, because a failure is
 * exactly when the output is worth reading; and a record never leaks onto a row
 * that does not own it.
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

/** The claude row, with an update record attached. */
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
    let opened = 0;
    const el = mountClaude({
      updating: 'claude',
      progress: 'adapter',
      log: { harness: 'claude', message: null },
      onOpenLog: () => { opened += 1; },
    });
    const row = harnessRows(el)[0];
    expect(row.textContent).toContain('Installing adapter…');
    const log = row.querySelector<HTMLButtonElement>('[data-update-log]');
    expect(log?.textContent).toBe('View log');
    act(() => log!.click());
    expect(opened).toBe(1);
  });

  test('after the run settles the log stays, with the run’s sentence', () => {
    const el = mountClaude({
      log: { harness: 'claude', message: 'claude update failed (exit 3)' },
      onOpenLog: () => {},
    });
    const row = harnessRows(el)[0];
    expect(row.textContent).toContain('claude update failed (exit 3)');
    expect(row.querySelector('[data-update-log]')).not.toBeNull();
  });

  test('a record for another harness does not appear on this row', () => {
    const el = mountClaude({ log: { harness: 'codex', message: 'codex updated' } });
    expect(harnessRows(el)[0].querySelector('[data-update-log]')).toBeNull();
  });
});
