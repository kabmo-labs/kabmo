/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The user browser's tab model.
 *
 * Every rule here is one a user can see: Back must not land on another tab's
 * page, closing the active tab must keep you in the region you were reading, a
 * re-submitted address must reload, and a stored blob written by an older build
 * must not crash the strip. `frameKey` is the one that is easy to get wrong and
 * invisible when wrong — an unchanged `src` never navigates.
 */

import { describe, expect, test } from 'bun:test';
import {
  MAX_TAB_HISTORY,
  MAX_USER_BROWSER_TABS,
  activeTabOf,
  closeTabIn,
  createTab,
  pruneTabs,
  pushAddress,
  reloadTab,
  stepTab,
  tabCanGoBack,
  tabCanGoForward,
  tabLabel,
  tabUrl,
  type UserBrowserTab,
} from '@/shared/lib/browser/user-tabs';

const tab = (id: string, ...urls: string[]): UserBrowserTab => ({
  id,
  history: urls,
  index: urls.length - 1,
  frameKey: 0,
});

describe('tab history', () => {
  test('a blank tab has no URL, no Back and no Forward', () => {
    const blank = createTab('t1');
    expect(tabUrl(blank)).toBe('');
    expect(tabCanGoBack(blank)).toBe(false);
    expect(tabCanGoForward(blank)).toBe(false);
  });

  test('pushing an address appends, bumps the frame key, and keeps Back working', () => {
    const first = pushAddress(createTab('t1'), 'https://a.test/');
    const second = pushAddress(first, 'https://b.test/');
    expect(tabUrl(second)).toBe('https://b.test/');
    // The bump is what reloads an unchanged `src`: submit twice, two loads.
    expect(second.frameKey).toBe(2);
    expect(tabCanGoBack(second)).toBe(true);
    expect(tabUrl(stepTab(second, -1))).toBe('https://a.test/');
  });

  test('a new address after Back drops the forward branch', () => {
    const tabbed = pushAddress(pushAddress(createTab('t1'), 'https://a.test/'), 'https://b.test/');
    const back = stepTab(tabbed, -1);
    const pushed = pushAddress(back, 'https://c.test/');
    expect(pushed.history).toEqual(['https://a.test/', 'https://c.test/']);
    expect(tabCanGoForward(pushed)).toBe(false);
  });

  test('re-submitting the SAME address reloads instead of duplicating', () => {
    const once = pushAddress(createTab('t1'), 'https://a.test/');
    const twice = pushAddress(once, 'https://a.test/');
    expect(twice.history).toEqual(['https://a.test/']);
    expect(twice.frameKey).toBe(2);
  });

  test('stepping past either end is a no-op, and reload keeps the address', () => {
    const only = pushAddress(createTab('t1'), 'https://a.test/');
    expect(stepTab(only, -1)).toBe(only);
    expect(stepTab(only, 1)).toBe(only);
    const reloaded = reloadTab(only);
    expect(tabUrl(reloaded)).toBe('https://a.test/');
    expect(reloaded.frameKey).toBe(only.frameKey + 1);
  });

  test('history is bounded, and the address on screen survives the trim', () => {
    let current = createTab('t1');
    for (let i = 0; i < MAX_TAB_HISTORY + 5; i += 1) current = pushAddress(current, `https://p${i}.test/`);
    expect(current.history.length).toBe(MAX_TAB_HISTORY);
    expect(current.history[current.index]).toBe(`https://p${MAX_TAB_HISTORY + 4}.test/`);
  });
});

describe('closeTabIn', () => {
  const tabs = [tab('a', 'https://a/'), tab('b', 'https://b/'), tab('c', 'https://c/')];

  test('closing the active tab selects the neighbour to its right', () => {
    const result = closeTabIn(tabs, 'b', 'b');
    expect(result.tabs.map((entry) => entry.id)).toEqual(['a', 'c']);
    expect(result.activeId).toBe('c');
  });

  test('closing the last tab selects the one to its left', () => {
    const result = closeTabIn(tabs, 'c', 'c');
    expect(result.activeId).toBe('b');
  });

  test('closing a background tab never moves the selection', () => {
    const result = closeTabIn(tabs, 'a', 'c');
    expect(result.activeId).toBe('a');
    expect(result.tabs.map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  test('an unknown id is not a close', () => {
    expect(closeTabIn(tabs, 'a', 'zzz')).toEqual({ tabs, activeId: 'a' });
  });
});

describe('activeTabOf', () => {
  test('a stale stored id falls back to the newest tab, never to nothing', () => {
    const tabs = [tab('a'), tab('b')];
    expect(activeTabOf(tabs, 'gone')?.id).toBe('b');
    expect(activeTabOf([], 'gone')).toBeNull();
  });
});

describe('pruneTabs', () => {
  test('rejects a non-array and drops entries that are not tabs', () => {
    expect(pruneTabs(null)).toEqual([]);
    expect(pruneTabs('nope')).toEqual([]);
    expect(pruneTabs([1, 'x', null, { id: '' }])).toEqual([]);
  });

  test('clamps an out-of-range index onto a real entry, and a blank tab keeps -1', () => {
    const [clamped] = pruneTabs([{ id: 'a', history: ['https://a/', 'https://b/'], index: 9, frameKey: 2 }]);
    expect(clamped).toEqual({ id: 'a', history: ['https://a/', 'https://b/'], index: 1, frameKey: 2 });
    const [blank] = pruneTabs([{ id: 'b', history: [], index: 4 }]);
    expect(blank?.index).toBe(-1);
    expect(blank?.frameKey).toBe(0);
  });

  test('drops duplicate ids and junk history entries', () => {
    const pruned = pruneTabs([
      { id: 'a', history: ['https://a/', 42, '', 'https://b/'], index: 1 },
      { id: 'a', history: ['https://dup/'], index: 0 },
    ]);
    expect(pruned.length).toBe(1);
    expect(pruned[0]?.history).toEqual(['https://a/', 'https://b/']);
    // The junk entry at index 1 was removed, so the index stays on a real URL.
    expect(tabUrl(pruned[0]!)).toBe('https://b/');
  });

  test('never returns more tabs than the cap', () => {
    const many = Array.from({ length: MAX_USER_BROWSER_TABS + 4 }, (_, index) => ({
      id: `t${index}`,
      history: [`https://p${index}.test/`],
      index: 0,
    }));
    expect(pruneTabs(many).length).toBe(MAX_USER_BROWSER_TABS);
  });
});

describe('tabLabel', () => {
  test('reads as host + path, and a blank tab says so', () => {
    expect(tabLabel(tab('a', 'https://example.com/docs/page'))).toBe('example.com/docs/page');
    expect(tabLabel(createTab('b'))).toBe('Tab baru');
  });
});
