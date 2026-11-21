/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The panel-navigation setting's live-apply half.
 *
 * Two columns, two keys, and the failure this file exists to prevent:
 * **a change addressed to one column re-mounting the other's tree.** The left
 * column's mount owns the session list's expansion, scroll and batch selection;
 * the right column's owns a terminal's PTY. An event that repainted both would
 * cost one of them for a setting that did not touch it.
 *
 * `applyPanelNav` is idempotent in the only sense that matters here — it resolves
 * the value and announces the resolved one — so a settings path that fires twice
 * with the same value repaints the same tree with the same style.
 *
 * No database: this module reads the primed client snapshot and dispatches a
 * window event. The write is the settings modal's own `writeKabmoSettings`.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { primeKabmoSettings } from '@/shared/lib/settings/client';
import {
  PANEL_NAV_CHANGED_EVENT,
  PANEL_NAV_SETTING_KEY,
  applyPanelNav,
  currentPanelNav,
} from '@/client/hooks/workspace/panel-nav';
import {
  MOBILE_RIGHT_PANEL_NAV_CHANGED_EVENT,
  MOBILE_RIGHT_PANEL_NAV_SETTING_KEY,
  applyMobileRightPanelNav,
  currentMobileRightPanelNav,
} from '@/client/hooks/workspace/mobile-right-panel-nav';

/** The events dispatched while the current test ran; `detail` may be absent. */
const dispatched: unknown[] = [];

// `applyPanelNav` bails out in a process with no window; give this file one so
// the dispatch path is the real one, and stand in for the settings write.
const fakeWindow = globalThis as unknown as {
  window?: unknown;
  CustomEvent?: unknown;
};

fakeWindow.window ??= {
  dispatchEvent: (event: { detail?: { side?: unknown; style?: unknown } }) => {
    dispatched.push(event.detail ?? {});
    return true;
  },
};
fakeWindow.CustomEvent ??= class {
  detail: unknown;
  constructor(_type: string, init?: { detail?: unknown }) {
    this.detail = init?.detail;
  }
};

afterEach(() => dispatched.length = 0);

describe('currentPanelNav', () => {
  test('reads each column from its own key', () => {
    primeKabmoSettings({ leftPanelNav: 'tabs', rightPanelNav: 'rail' });
    expect(currentPanelNav('left')).toBe('tabs');
    expect(currentPanelNav('right')).toBe('rail');
  });

  test('the two keys are independent, so one choice cannot carry to the other', () => {
    primeKabmoSettings({ leftPanelNav: 'rail', rightPanelNav: 'tabs' });
    expect(currentPanelNav('left')).toBe('rail');
    expect(currentPanelNav('right')).toBe('tabs');
  });

  test('an unset or unreadable value resolves to the rail, which is what ships', () => {
    primeKabmoSettings({ leftPanelNav: 'from-a-newer-build' });
    expect(currentPanelNav('left')).toBe('rail');
    expect(currentPanelNav('right')).toBe('rail');
  });

  test('the keys it reads are the settings fields the app persists', () => {
    expect(PANEL_NAV_SETTING_KEY.left).toBe('leftPanelNav');
    expect(PANEL_NAV_SETTING_KEY.right).toBe('rightPanelNav');
  });
});

describe('applyPanelNav', () => {
  test('announces the SIDE and the resolved style', () => {
    applyPanelNav('right', 'tabs');
    expect(dispatched).toEqual([{ side: 'right', style: 'tabs' }]);
    expect(PANEL_NAV_CHANGED_EVENT).toBe('omp:panel-nav-changed');
  });

  test('an unreadable value is announced as the shipped default, never as itself', () => {
    applyPanelNav('left', 'whatever');
    expect(dispatched).toEqual([{ side: 'left', style: 'rail' }]);
  });

  test('two changes addressed to different columns stay separate events', () => {
    applyPanelNav('left', 'tabs');
    applyPanelNav('right', 'tabs');
    expect(dispatched).toEqual([
      { side: 'left', style: 'tabs' },
      { side: 'right', style: 'tabs' },
    ]);
  });
});

describe('the phone drawer setting', () => {
  afterEach(() => dispatched.length = 0);

  test('reads its own key, so a desktop column cannot answer for it', () => {
    primeKabmoSettings({ leftPanelNav: 'tabs', rightPanelNav: 'tabs', mobileRightPanelNav: 'classic' });
    expect(currentMobileRightPanelNav()).toBe('classic');
  });

  test('an unset or unreadable value is the shipped default', () => {
    primeKabmoSettings({ mobileRightPanelNav: 'from-a-newer-build' });
    expect(currentMobileRightPanelNav()).toBe('classic');
  });

  test('the key matches the settings field it persists under', () => {
    expect(MOBILE_RIGHT_PANEL_NAV_SETTING_KEY).toBe('mobileRightPanelNav');
  });

  test('it announces on its OWN event, not the desktop one', () => {
    applyMobileRightPanelNav('tabs');
    // Its detail is the resolved STYLE, not `{side, style}`: the phone has one
    // drawer, so there is no side for the listener to compare.
    expect(dispatched).toEqual(['tabs']);
    expect(MOBILE_RIGHT_PANEL_NAV_CHANGED_EVENT).toBe('omp:mobile-right-panel-nav-changed');
    expect(MOBILE_RIGHT_PANEL_NAV_CHANGED_EVENT).not.toBe(PANEL_NAV_CHANGED_EVENT);
  });

  test('an unreadable value is announced as the default, never as itself', () => {
    applyMobileRightPanelNav('whatever');
    expect(dispatched).toEqual(['classic']);
  });
});
