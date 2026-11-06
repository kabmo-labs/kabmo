/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The dismissal control on an in-place refusal.
 *
 * A switch or probe refusal is the agent's own words, so it is stated in the
 * page rather than in a toast that closes before it can be read — which means it
 * has to be closable. Before this, the only way an error left the page was the
 * next action succeeding, so a persistently failing harness kept a banner that
 * became part of the furniture.
 *
 * The two facts pinned here:
 *
 *  - the dismiss control is a real named button (not a bare `×`), so assistive
 *    tech can say WHICH notice it closes;
 *  - dismissing removes the MESSAGE only — the caller decides that, and the row
 *    beside it still states `not installed` and still disables `Check`.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { SettingsNotice } from '@/client/components/settings/categories/harness-settings/parts';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
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
  restoreDomGlobals();
});

describe('SettingsNotice', () => {
  test('states the message and offers a NAMED dismiss button', () => {
    let dismissed = 0;
    act(() =>
      render(
        h(SettingsNotice, {
          message: 'executable not found (command: pi)',
          onDismiss: () => { dismissed += 1; },
          dismissLabel: 'Dismiss this message',
        }),
        container,
      ),
    );

    expect(container.textContent).toContain('executable not found (command: pi)');
    const button = container.querySelector('button');
    expect(button).not.toBeNull();
    // A bare `×` reads as "times" to a screen reader, which says nothing about
    // what it closes.
    expect(button?.getAttribute('aria-label')).toBe('Dismiss this message');
    expect(button?.getAttribute('title')).toBe('Dismiss this message');
  });

  test('clicking it calls the handler exactly once', () => {
    let dismissed = 0;
    act(() =>
      render(
        h(SettingsNotice, { message: 'boom', onDismiss: () => { dismissed += 1; } }),
        container,
      ),
    );
    act(() => {
      container.querySelector('button')?.dispatchEvent(
        new window.MouseEvent('click', { bubbles: true }),
      );
    });
    expect(dismissed).toBe(1);
  });

  test('a notice with nothing to dismiss draws no button', () => {
    // The same banner is used for a message the page must keep — an absent
    // `onDismiss` is the honest way to say "this one stays".
    act(() => render(h(SettingsNotice, { message: 'still true' }), container));
    expect(container.querySelector('button')).toBeNull();
    expect(container.textContent).toContain('still true');
  });
});
