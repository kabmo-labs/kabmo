/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The line under an updating harness row.
 *
 * The state it must not blur is the dismissal: a settled record is history and
 * carries an X, while a run that is installing (or waiting its turn) must not —
 * deleting a live record would hide the spinner and let a second install start.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { UpdateLogLine, type UpdateLogLineProps } from '@/client/components/layout/session-sidebar/about-modal/UpdateLogLine';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;

function mount(props: UpdateLogLineProps): HTMLElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => render(h(UpdateLogLine, props), container));
  return container;
}

const dismissControl = (el: HTMLElement): HTMLButtonElement | null =>
  el.querySelector<HTMLButtonElement>('button[aria-label="Dismiss update result"]');

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
});

afterAll(() => {
  restoreDomGlobals();
});

describe('UpdateLogLine', () => {
  test('a settled result states the message and offers the way out', () => {
    const el = mount({
      running: false,
      progress: null,
      message: 'claude updated (adapter) — it now reports 0.106.0',
      onDismiss: () => {},
    });
    expect(el.textContent).toContain('it now reports 0.106.0');
    expect(dismissControl(el)).not.toBeNull();
  });

  test('the dismiss control asks for that harness\'s record to be dropped', () => {
    let dismissed = 0;
    const el = mount({
      running: false,
      progress: null,
      message: 'claude updated (adapter)',
      onDismiss: () => {
        dismissed += 1;
      },
    });
    act(() => dismissControl(el)!.click());
    expect(dismissed).toBe(1);
  });

  test('an installing or queued run has no dismiss control', () => {
    const installing = mount({ running: true, progress: 'adapter', message: null, onDismiss: () => {} });
    expect(installing.textContent).toContain('Installing adapter…');
    expect(dismissControl(installing)).toBeNull();

    const queued = mount({ running: false, queued: true, progress: null, message: null, onDismiss: () => {} });
    expect(queued.textContent).toContain('Queued');
    expect(dismissControl(queued)).toBeNull();
  });
});
