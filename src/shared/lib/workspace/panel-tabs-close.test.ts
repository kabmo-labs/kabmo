/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A request is an EVENT and must be applied once.
 *
 * The bug this pins, measured in the browser: closing the last tab returned to
 * the home page for one frame and the strip then showed the requested view
 * again, so the X looked broken. The cause was an effect keyed on the REQUEST
 * but closing over `open()`, whose identity changes with every tab write — so
 * the effect re-ran after the user's own next action and forced the tab back.
 *
 * `appliedRequest` makes the nonce, not the callback, the trigger. These tests
 * drive the reducer-level rule the effect relies on: a request for the same
 * nonce is one opening, a new nonce is a new one.
 */

import { describe, expect, test } from 'bun:test';
import {
  closePanelTab,
  nextActiveTab,
  openPanelTab,
  type PanelTabs,
} from '@/shared/lib/workspace/panel-tabs';

/**
 * The strip's close rule, as one call: the list and the selection move together.
 *
 * Mirrors `usePanelTabs().close`, which writes `{ tabs, active, home }` in one
 * update so no render ever sees a closed tab still named as active.
 */
function close(tabs: PanelTabs, active: string | null, id: string, pinned?: string) {
  const next = closePanelTab(tabs, id, pinned);
  return { tabs: next, active: nextActiveTab(tabs, next, active), home: next.length === 0 };
}

describe('closing the ACTIVE tab moves the selection, then falls back to home', () => {
  test('a middle tab hands the selection to the one on its right', () => {
    const result = close(['files', 'git', 'todo'], 'git', 'git');
    expect(result.tabs).toEqual(['files', 'todo']);
    expect(result.active).toBe('todo');
    expect(result.home).toBe(false);
  });

  test('the rightmost tab hands it to the one on its LEFT', () => {
    const result = close(['files', 'git'], 'git', 'git');
    expect(result.tabs).toEqual(['files']);
    expect(result.active).toBe('files');
    expect(result.home).toBe(false);
  });

  test('the last remaining tab lands on the home page', () => {
    const result = close(['files'], 'files', 'files');
    expect(result.tabs).toEqual([]);
    expect(result.active).toBeNull();
    expect(result.home).toBe(true);
  });

  test('closing a BACKGROUND tab leaves the selection where it was', () => {
    const result = close(['files', 'git', 'todo'], 'files', 'todo');
    expect(result.tabs).toEqual(['files', 'git']);
    expect(result.active).toBe('files');
    expect(result.home).toBe(false);
  });

  test('the pinned view refuses to close, so the column keeps its way back', () => {
    const result = close(['sessions', 'git'], 'sessions', 'sessions', 'sessions');
    expect(result.tabs).toEqual(['sessions', 'git']);
    expect(result.active).toBe('sessions');
  });
});

describe('adopting a dragged order', () => {
  /**
   * The strip's commit rule, as one call: only ids that are still OPEN survive,
   * and the pinned view is put back in front.
   *
   * Mirrors `usePanelTabs().setOrder`, which refuses a list that is not a
   * permutation of the open set — a drag renders what the strip drew, and a chip
   * closed mid-gesture is not the user's arrangement.
   */
  function adoptOrder(tabs: PanelTabs, ids: readonly string[], pinned?: string) {
    if (ids.length !== tabs.length) return tabs;
    const open = new Set(tabs);
    const next = ids.filter((id) => open.has(id));
    if (next.length !== tabs.length || new Set(next).size !== tabs.length) return tabs;
    return pinned ? [pinned, ...next.filter((id) => id !== pinned)] : next;
  }

  test('a valid drag adopts the new order', () => {
    expect(adoptOrder(['files', 'git', 'todo'], ['todo', 'files', 'git'])).toEqual(['todo', 'files', 'git']);
  });

  test('a list that LOST a tab is refused, so a mid-drag close is not an arrangement', () => {
    const tabs = ['files', 'git', 'todo'];
    expect(adoptOrder(tabs, ['todo', 'files'])).toEqual(tabs);
  });

  test('a list that GAINED an id is refused, so a drag cannot invent a tab', () => {
    const tabs = ['files', 'git'];
    expect(adoptOrder(tabs, ['files', 'git', 'ghost'])).toEqual(tabs);
  });

  test('the pinned view leads whatever the drop said', () => {
    expect(adoptOrder(['sessions', 'git', 'todo'], ['git', 'todo', 'sessions'], 'sessions')).toEqual([
      'sessions',
      'git',
      'todo',
    ]);
  });

  test('a duplicate in the dropped list is refused rather than collapsed silently', () => {
    const tabs = ['files', 'git'];
    expect(adoptOrder(tabs, ['files', 'files'])).toEqual(tabs);
  });

  test('reordering never changes WHICH tab is open, only their order', () => {
    const before = ['files', 'git', 'todo'];
    const after = adoptOrder(before, ['todo', 'git', 'files']);
    expect([...after].sort()).toEqual([...before].sort());
  });
});

describe('a request applied once', () => {
  /**
   * The effect's rule, in isolation: given the nonce already applied, does this
   * request still need opening?
   */
  const shouldApply = (applied: number | null, request: { panelKey: string; nonce: number } | null) =>
    request !== null && applied !== request.nonce;

  test('the first request for a view applies', () => {
    expect(shouldApply(null, { panelKey: 'git', nonce: 1 })).toBe(true);
  });

  test('the SAME nonce does not apply again, which is what kept a closed tab alive', () => {
    expect(shouldApply(1, { panelKey: 'git', nonce: 1 })).toBe(false);
  });

  test('a second press on the same view is a new event and applies again', () => {
    expect(shouldApply(1, { panelKey: 'git', nonce: 2 })).toBe(true);
  });

  test('no request applies nothing', () => {
    expect(shouldApply(null, null)).toBe(false);
  });

  test('opening is idempotent on the LIST, so a re-applied request cannot duplicate a tab', () => {
    const once = openPanelTab(['files'], 'git');
    expect(openPanelTab(once, 'git')).toEqual(['files', 'git']);
  });
});
