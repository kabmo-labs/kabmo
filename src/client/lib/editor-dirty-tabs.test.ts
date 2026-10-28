/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The per-tab dirty store.
 *
 * The rule worth pinning is the one a `Set` makes easy to get wrong: an unchanged
 * publish must return the SAME snapshot object, or every subscriber re-renders on
 * every keystroke elsewhere in the panel. And `retain` must drop a closed tab's
 * entry, or a freshly opened tab that reuses the id would come up already dotted.
 */

import { afterEach, describe, expect, test } from 'bun:test';

import {
  hasDirtyTabs,
  isTabDirty,
  resetDirtyTabs,
  retainDirtyTabs,
  setDirtyTabs,
  subscribeDirtyTabs,
} from '@/client/lib/editor-dirty-tabs';

afterEach(() => {
  resetDirtyTabs();
});

describe('setDirtyTabs', () => {
  test('records exactly what it was given', () => {
    setDirtyTabs(['a', 2]);
    expect(isTabDirty('a')).toBe(true);
    expect(isTabDirty(2)).toBe(true);
    expect(isTabDirty('b')).toBe(false);
    expect(hasDirtyTabs()).toBe(true);
  });

  test('replaces rather than merges, so a saved tab stops being dirty', () => {
    setDirtyTabs(['a', 'b']);
    setDirtyTabs(['a']);
    expect(isTabDirty('b')).toBe(false);
  });

  test('an empty set clears the flag the unload guard reads', () => {
    setDirtyTabs(['a']);
    setDirtyTabs([]);
    expect(hasDirtyTabs()).toBe(false);
  });
});

describe('retainDirtyTabs', () => {
  test('drops the ids that left the tab set', () => {
    setDirtyTabs(['a', 'b', 'c']);
    retainDirtyTabs(['a']);
    expect(isTabDirty('a')).toBe(true);
    expect(isTabDirty('b')).toBe(false);
    expect(isTabDirty('c')).toBe(false);
  });

  test('a closed tab’s id does not decorate a tab that reuses it', () => {
    setDirtyTabs([7]);
    retainDirtyTabs([]);
    // The same id, a different file: the entry is gone, so the tab opens clean.
    expect(isTabDirty(7)).toBe(false);
  });
});

describe('a publish that changes nothing notifies nobody', () => {
  test('the same set twice is ONE notification', () => {
    // The panel re-renders on every keystroke, so a publish that re-notifies an
    // unchanged set would re-render the whole tab strip for nothing.
    let calls = 0;
    const stop = subscribeDirtyTabs(() => { calls += 1; });
    setDirtyTabs(['a']);
    expect(calls).toBe(1);
    setDirtyTabs(['a']);
    expect(calls).toBe(1);
    setDirtyTabs(['a', 'b']);
    expect(calls).toBe(2);
    stop();
  });

  test('a retain that drops nothing is silent, and one that drops a row notifies', () => {
    setDirtyTabs(['a']);
    let calls = 0;
    const stop = subscribeDirtyTabs(() => { calls += 1; });
    retainDirtyTabs(['a', 'b']);
    expect(calls).toBe(0);
    retainDirtyTabs(['b']);
    expect(calls).toBe(1);
    stop();
  });

  test('a released subscriber stops hearing about changes', () => {
    let calls = 0;
    const stop = subscribeDirtyTabs(() => { calls += 1; });
    stop();
    setDirtyTabs(['a']);
    expect(calls).toBe(0);
  });
});
