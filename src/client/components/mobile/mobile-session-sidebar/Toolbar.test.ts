/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The mobile toolbar's Archive control.
 *
 * It used to live inside the sort dropdown under a "Filter" heading, so the
 * control that decides whether archived rows are on screen sat one tap deeper
 * than the control that reorders the list, and the sort button's own pressed
 * state reported BOTH (it lit up when only the archive filter was on). The
 * assertions below pin the shape that replaced it: a standalone button beside
 * Scheduler/Refresh, and a sort dropdown that means the order alone.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { MobileSessionToolbar } from '@/client/components/mobile/mobile-session-sidebar/Toolbar';
import type { MobileSessionToolbarProps } from '@/client/components/mobile/mobile-session-sidebar/Toolbar';

let container: HTMLElement;

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent'] as const;
/** The runner's own globals, restored on teardown — deleting them would strip natives (Event/CustomEvent) every later file needs. */
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

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
  container?.remove();
});

async function mount(overrides: Partial<MobileSessionToolbarProps> = {}) {
  const calls = { toggled: 0, hidden: 0 };
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(MobileSessionToolbar, {
      searchQuery: '',
      sortOption: 'A-Z',
      optionsOpen: false,
      showArchived: false,
      optionsRef: { current: null },
      onNewSession: () => {},
      onNewWorkspace: () => {},
      onScheduler: () => {},
      scheduledCount: 0,
      onRefresh: () => {},
      refreshing: false,
      onToggleOptions: () => {},
      onSortChange: () => {},
      onResetSort: () => {},
      onToggleArchived: () => { calls.toggled += 1; },
      onHideArchived: () => { calls.hidden += 1; },
      onSearchChange: () => {},
      onClearSearch: () => {},
      ...overrides,
    }), container);
  });
  return { el: container, calls };
}

/** The archive button by its accessible name — the two labels are the two states. */
function archiveButton(el: HTMLElement) {
  return Array.from(el.querySelectorAll('button')).find((b) => /archived sessions/i.test(b.getAttribute('aria-label') ?? '')) ?? null;
}

describe('mobile toolbar archive button', () => {
  test('is a standalone control in the toolbar row, not inside the sort dropdown', async () => {
    const { el } = await mount();
    const button = archiveButton(el);
    expect(button).not.toBeNull();
    // The dropdown is closed here, so a button found at all proves it is not
    // one of the dropdown's own rows.
    expect(button?.getAttribute('aria-pressed')).toBe('false');
    expect(button?.querySelector('svg')?.getAttribute('class')).toContain('lucide-archive');
  });

  test('reports the on state through aria-pressed, and switches its label with it', async () => {
    const { el } = await mount({ showArchived: true });
    const button = archiveButton(el);
    expect(button?.getAttribute('aria-pressed')).toBe('true');
    expect(button?.getAttribute('aria-label')).toBe('Hide archived sessions');
    // And the archive pill in row 3 offers the same escape as before.
    expect(el.textContent).toContain('Archived');
  });

  test('toggles the filter on click', async () => {
    const { el, calls } = await mount();
    await act(async () => {
      (archiveButton(el) as HTMLButtonElement).click();
    });
    expect(calls.toggled).toBe(1);
  });

  test('the sort dropdown carries sort options only — no archive row', async () => {
    const { el } = await mount({ optionsOpen: true });
    expect(el.textContent).toContain('Sort Workspaces');
    expect(el.textContent).not.toContain('Show Archived');
    // And no stray "Filter" heading is left behind with nothing under it.
    expect(el.textContent).not.toContain('Filter');
  });

  test('the sort trigger still lights up for a non-default sort', async () => {
    const { el } = await mount({ sortOption: 'LATEST_SESSION' });
    const sortTrigger = Array.from(el.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === 'Sort workspaces');
    expect(sortTrigger?.className).toContain('bg-ink/10');
  });

  test('the archive filter does not light up the sort trigger', async () => {
    const { el } = await mount({ showArchived: true });
    const sortTrigger = Array.from(el.querySelectorAll('button')).find((b) => b.getAttribute('aria-label') === 'Sort workspaces');
    expect(sortTrigger?.className).not.toContain('bg-ink/10');
  });
});
