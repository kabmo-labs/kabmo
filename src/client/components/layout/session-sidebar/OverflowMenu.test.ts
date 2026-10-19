/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The toolbar's `⋯` menu.
 *
 * When the row cannot hold every control, the ones that do not fit move here
 * rather than disappearing — a control reachable only at one sidebar width is
 * a control half the users never find. These cases pin the three behaviours
 * that make it usable: the rows are named in words, a row runs its action and
 * closes the menu, and Escape closes it.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { Archive, RefreshCw } from 'lucide-preact';

import { ToolbarOverflowMenu } from '@/client/components/layout/session-sidebar/OverflowMenu';
import type { OverflowAction } from '@/client/components/layout/session-sidebar/OverflowMenu';

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

async function mount(actions: OverflowAction[], sortHidden = false) {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(ToolbarOverflowMenu, {
      actions,
      sortHidden,
      sortOption: 'A-Z',
      onSortChange: () => {},
    }), container);
  });
  return container;
}

const trigger = (el: HTMLElement) =>
  Array.from(el.querySelectorAll('button'))
    .find((b) => b.getAttribute('aria-label') === 'More sidebar actions') as HTMLButtonElement | undefined;

describe('toolbar overflow menu', () => {
  test('is closed until its trigger is pressed', async () => {
    const el = await mount([{ id: 'refresh', label: 'Refresh sessions', icon: RefreshCw, onSelect: () => {} }]);
    expect(trigger(el)?.getAttribute('aria-expanded')).toBe('false');
    expect(el.querySelector('[role="menu"]')).toBeNull();
  });

  test('names every moved control in words, not as a glyph', async () => {
    const el = await mount([
      { id: 'refresh', label: 'Refresh sessions', icon: RefreshCw, onSelect: () => {} },
      { id: 'archive', label: 'Show Archive', icon: Archive, onSelect: () => {}, active: true },
    ]);
    await act(async () => { trigger(el)?.click(); });
    const rows = Array.from(el.querySelectorAll('[role="menuitem"]')).map((row) => row.textContent?.trim());
    expect(rows).toEqual(['Refresh sessions', 'Show Archive']);
    // A moved control still reports its own pressed state.
    expect(el.querySelector('[role="menuitem"][aria-pressed="true"]')?.textContent).toContain('Show Archive');
  });

  test('a row runs its action and closes the menu', async () => {
    let ran = 0;
    const el = await mount([{ id: 'refresh', label: 'Refresh sessions', icon: RefreshCw, onSelect: () => { ran += 1; } }]);
    await act(async () => { trigger(el)?.click(); });
    const row = el.querySelector('[role="menuitem"]') as HTMLElement;
    await act(async () => { row.click(); });
    expect(ran).toBe(1);
    expect(el.querySelector('[role="menu"]')).toBeNull();
  });

  test('Escape closes the menu', async () => {
    const el = await mount([{ id: 'refresh', label: 'Refresh sessions', icon: RefreshCw, onSelect: () => {} }]);
    await act(async () => { trigger(el)?.click(); });
    expect(el.querySelector('[role="menu"]')).not.toBeNull();
    await act(async () => {
      document.dispatchEvent(new globalThis.KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(el.querySelector('[role="menu"]')).toBeNull();
  });

  test('carries the sort options when the sort control itself moved', async () => {
    const el = await mount([], true);
    await act(async () => { trigger(el)?.click(); });
    expect(el.textContent).toContain('Sort Workspaces');
  });
});
