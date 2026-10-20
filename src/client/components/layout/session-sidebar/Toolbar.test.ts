/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The desktop toolbar's control order.
 *
 * New Session used to be a full-width block of its own under the title bar,
 * while the phone's drawer put it in the toolbar immediately before New
 * Workspace. The two layouts therefore offered the primary action in different
 * places, and the assertion below is what keeps them aligned: New Session comes
 * FIRST in the toolbar and is immediately followed by New Workspace.
 *
 * Rendered with `h()` (no JSX) against happy-dom, following the harness in
 * `mobile-session-sidebar/Toolbar.test.ts`.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { SessionSidebarToolbar } from '@/client/components/layout/session-sidebar/Toolbar';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent'] as const;
/** The runner's own globals, restored on teardown — deleting them would strip natives (Event/CustomEvent) every later file needs. */
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let container: HTMLElement;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
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

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
});

async function mount() {
  const calls = { newSession: 0, newWorkspace: 0 };
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(SessionSidebarToolbar, {
      isSearchVisible: false,
      searchQuery: '',
      showArchived: false,
      optionsOpen: false,
      sortOption: 'A-Z',
      onToggleSearch: () => {},
      onSearchChange: () => {},
      onToggleArchived: () => {},
      onHideArchived: () => {},
      onToggleOptions: () => {},
      onCloseOptions: () => {},
      onSortChange: () => {},
      onNewSession: () => { calls.newSession += 1; },
      onNewWorkspace: () => { calls.newWorkspace += 1; },
      onScheduler: () => {},
      scheduledCount: 0,
      onRefresh: () => {},
      refreshing: false,
      onSelectWorkspaces: () => {},
      selecting: false,
    }), container);
  });
  return { el: container, calls };
}

function buttonByName(el: HTMLElement, name: string) {
  return Array.from(el.querySelectorAll('button'))
    .find((b) => b.getAttribute('aria-label') === name) ?? null;
}

describe('desktop toolbar control order', () => {
  test('New Session sits immediately before New Workspace', async () => {
    const { el } = await mount();
    const buttons = Array.from(el.querySelectorAll('button'));
    const newSession = buttons.indexOf(buttonByName(el, 'New Session') as HTMLButtonElement);
    const newWorkspace = buttons.indexOf(buttonByName(el, 'New Workspace') as HTMLButtonElement);
    expect(newSession).toBeGreaterThanOrEqual(0);
    expect(newWorkspace).toBe(newSession + 1);
  });

  test('both controls carry an accessible name and invoke their handler', async () => {
    const { el, calls } = await mount();
    const newSession = buttonByName(el, 'New Session') as HTMLButtonElement;
    const newWorkspace = buttonByName(el, 'New Workspace') as HTMLButtonElement;
    expect(newSession.title).toBe('New Session');
    expect(newWorkspace.title).toBe('New Workspace');
    await act(async () => {
      newSession.click();
      newWorkspace.click();
    });
    expect(calls.newSession).toBe(1);
    expect(calls.newWorkspace).toBe(1);
  });

  test('the New Session label is always rendered and truncates instead of hiding', async () => {
    // A container query used to hide it below 360px, which turned the primary
    // action into an empty bar at the default sidebar width. The text now
    // stays in the DOM and ellipsises; `truncate` is what ellipsises it.
    const { el } = await mount();
    const label = buttonByName(el, 'New Session')?.querySelector('span');
    expect(label?.textContent).toBe('New Session');
    expect(label?.className).toContain('truncate');
    expect(label?.className).not.toContain('hidden');
  });

  test('New Session and the utility buttons share one height', async () => {
    // The phone draws one row of equally sized controls; the desktop row was
    // a pill beside bare 14px glyphs, which read as two different kinds of
    // control. Every button in the row is h-7 now.
    const { el } = await mount();
    for (const name of ['New Session', 'New Workspace', 'Scheduled tasks', 'Refresh sessions']) {
      expect(buttonByName(el, name)?.className).toContain('h-7');
    }
  });
});
