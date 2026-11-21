/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The panel-navigation setting's contract, and the tab working set built on it.
 *
 * Two failure modes are worth pinning, and each was a design decision:
 *
 * - **a stored value this build cannot draw must resolve to the shipped
 *   default** (the rail), because the alternative is naming a renderer that does
 *   not exist. The default is the rail so an upgrade rearranges nothing.
 * - **one tab per panel.** The tab id IS the key, so opening a view that is
 *   already open focuses it — the duplicate tab a card grid invites is
 *   impossible by construction, not by remembering to check.
 *
 * The tab rules are pure functions over arrays, which is why they are tested
 * here rather than through a mounted strip: a close that picks the wrong
 * neighbour is a data bug, and a DOM test would only observe its shadow.
 */

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_MOBILE_RIGHT_PANEL_NAV,
  DEFAULT_PANEL_NAV,
  MOBILE_RIGHT_PANEL_NAVS,
  MOBILE_RIGHT_PANEL_NAV_KEY,
  PANEL_NAV_COPY,
  PANEL_NAV_SETTING_KEYS,
  PANEL_NAV_STYLES,
  isPanelNavSide,
  isPanelNavStyle,
  isMobileRightPanelNav,
  resolveMobileRightPanelNav,
  resolvePanelNav,
} from '@/shared/lib/workspace/panel-nav';
import {
  closePanelTab,
  nextActiveTab,
  openPanelTab,
  visiblePanelTabs,
  withPinnedTab,
} from '@/shared/lib/workspace/panel-tabs';

describe('resolvePanelNav', () => {
  test('the shipped default is the rail, so an upgrade rearranges nothing', () => {
    expect(DEFAULT_PANEL_NAV).toBe('rail');
  });

  test('every style this build can draw resolves to itself', () => {
    for (const style of PANEL_NAV_STYLES) expect(resolvePanelNav(style)).toBe(style);
  });

  test('an unknown value falls back to the default rather than to a missing renderer', () => {
    for (const value of ['sidebar', '', 'Tabs', null, undefined, 0, {}, []]) {
      expect(resolvePanelNav(value)).toBe(DEFAULT_PANEL_NAV);
    }
  });

  test('the guard agrees with the resolver', () => {
    expect(isPanelNavStyle('tabs')).toBe(true);
    expect(isPanelNavStyle('rail')).toBe(true);
    expect(isPanelNavStyle('TABS')).toBe(false);
  });

  test('every style has copy, so a settings card cannot render an empty label', () => {
    for (const style of PANEL_NAV_STYLES) {
      expect(PANEL_NAV_COPY[style].label.length).toBeGreaterThan(0);
      expect(PANEL_NAV_COPY[style].description.length).toBeGreaterThan(0);
    }
  });

  test('the two columns have their own key, so one choice cannot overwrite the other', () => {
    expect(PANEL_NAV_SETTING_KEYS.left).toBe('leftPanelNav');
    expect(PANEL_NAV_SETTING_KEYS.right).toBe('rightPanelNav');
    expect(PANEL_NAV_SETTING_KEYS.left).not.toBe(PANEL_NAV_SETTING_KEYS.right);
  });

  test('the side guard only accepts the two columns this build has', () => {
    expect(isPanelNavSide('left')).toBe(true);
    expect(isPanelNavSide('right')).toBe(true);
    expect(isPanelNavSide('editor')).toBe(false);
    expect(isPanelNavSide(undefined)).toBe(false);
  });
});

describe('openPanelTab', () => {
  test('a new view is appended', () => {
    expect(openPanelTab(['files'], 'git')).toEqual(['files', 'git']);
  });

  test('a view that is already open is NOT appended twice', () => {
    const once = openPanelTab(['files', 'git'], 'git');
    expect(once).toEqual(['files', 'git']);
    expect(once.filter((id) => id === 'git')).toHaveLength(1);
  });
});

describe('closePanelTab', () => {
  test('the named tab goes and the rest keep their order', () => {
    expect(closePanelTab(['files', 'git', 'todo'], 'git')).toEqual(['files', 'todo']);
  });

  test('the pinned view is refused, so the column always keeps its way back', () => {
    expect(closePanelTab(['sessions', 'git'], 'sessions', 'sessions')).toEqual(['sessions', 'git']);
  });

  test('closing an id that is not open changes nothing', () => {
    const tabs = ['files'];
    expect(closePanelTab(tabs, 'git')).toEqual(tabs);
  });
});

describe('nextActiveTab', () => {
  test('a surviving selection is kept, so closing a background tab does not move the view', () => {
    expect(nextActiveTab(['files', 'git', 'todo'], ['files', 'todo'], 'files')).toBe('files');
  });

  test('closing the active tab selects the one that slid into its place', () => {
    expect(nextActiveTab(['files', 'git', 'todo'], ['files', 'todo'], 'git')).toBe('todo');
  });

  test('closing the LAST active tab selects its left neighbour', () => {
    expect(nextActiveTab(['files', 'git'], ['files'], 'git')).toBe('files');
  });

  test('closing the only tab leaves nothing selected — the home page', () => {
    expect(nextActiveTab(['files'], [], 'files')).toBeNull();
  });

  test('a selection this build cannot draw falls back to the first tab', () => {
    expect(nextActiveTab(['gone'], ['files', 'git'], 'gone')).toBe('files');
  });
});

describe('visiblePanelTabs', () => {
  /** A stand-in for the catalog's id set; the rule under test is membership. */
  const known = (ids: readonly string[]): ReadonlySet<string> => new Set(ids);

  test('ids the column cannot draw are dropped, order preserved', () => {
    expect(visiblePanelTabs(['git', 'gone', 'files'], known(['files', 'git']))).toEqual(['git', 'files']);
  });

  test('duplicates in a stored list collapse to one tab per view', () => {
    expect(visiblePanelTabs(['files', 'files'], known(['files']))).toEqual(['files']);
  });

  test('everything filtered out is an empty list, not an error', () => {
    expect(visiblePanelTabs(['gone'], known([]))).toEqual([]);
  });
});

describe('withPinnedTab', () => {
  test('the pinned view leads', () => {
    expect(withPinnedTab(['git', 'todo'], 'sessions')).toEqual(['sessions', 'git', 'todo']);
  });

  test('a list that already leads with it is returned unchanged', () => {
    const tabs = ['sessions', 'git'];
    expect(withPinnedTab(tabs, 'sessions')).toBe(tabs);
  });

  test('the pinned view cannot be duplicated by a stored list', () => {
    expect(withPinnedTab(['git', 'sessions'], 'sessions')).toEqual(['sessions', 'git']);
  });
});

describe('the phone drawer is its own axis', () => {
  test('the shipped default is classic, so an upgrade rearranges nothing', () => {
    expect(DEFAULT_MOBILE_RIGHT_PANEL_NAV).toBe('classic');
  });

  test('both styles resolve to themselves', () => {
    for (const style of MOBILE_RIGHT_PANEL_NAVS) {
      expect(resolveMobileRightPanelNav(style)).toBe(style);
    }
  });

  test('an unknown value falls back to classic, not to a renderer that is missing', () => {
    for (const value of ['rail', '', 'Classic', null, undefined, 0, {}, []]) {
      expect(resolveMobileRightPanelNav(value)).toBe(DEFAULT_MOBILE_RIGHT_PANEL_NAV);
    }
  });

  test('the guard agrees with the resolver and refuses the desktop-only value', () => {
    expect(isMobileRightPanelNav('classic')).toBe(true);
    expect(isMobileRightPanelNav('tabs')).toBe(true);
    // `rail` is the desktop's word; a phone has no rail to draw.
    expect(isMobileRightPanelNav('rail')).toBe(false);
  });

  test('the key is its own, so the phone cannot overwrite a desktop column', () => {
    expect(MOBILE_RIGHT_PANEL_NAV_KEY).toBe('mobileRightPanelNav');
    expect(PANEL_NAV_SETTING_KEYS.left).not.toBe(MOBILE_RIGHT_PANEL_NAV_KEY);
    expect(PANEL_NAV_SETTING_KEYS.right).not.toBe(MOBILE_RIGHT_PANEL_NAV_KEY);
  });
});
