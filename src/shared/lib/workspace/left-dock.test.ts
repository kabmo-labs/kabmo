/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The left dock's placement rules.
 *
 * Three properties, and each fails SILENTLY when broken:
 *
 * - **The sessions view is always on the left and cannot be placed anywhere
 *   else.** It is the dock's own view, so a stored row naming it is dropped
 *   rather than accepted — otherwise a blob could leave the left column showing
 *   a plugin with no way back to the session list.
 * - **A panel is on ONE side at a time.** The same id keys the enablement set,
 *   the width map and the stored order, so a panel present in both lists would
 *   be two buttons for one panel and one of them would draw nothing.
 * - **A row this build does not recognise is dropped.** The list is not only a
 *   preference here: it decides which buttons the dock draws, so a stale id
 *   would be a button that resolves to nothing.
 */

import { describe, expect, test, beforeEach } from 'bun:test';
import { primeKabmoSettings, readKabmoSetting } from '@/shared/lib/settings/client';
import {
  LEFT_DOCK_SETTING_KEY,
  SESSIONS_VIEW_ID,
  isLeftDockPanelId,
  leftPanelIds,
  panelSideOf,
  readLeftDock,
  ridesSides,
  setPanelSide,
  writeLeftDock,
} from '@/shared/lib/workspace/left-dock';
import {
  LEFT_DOCK_WIDTHS_SETTING_KEY,
  MIN_LEFT_DOCK_PLUGIN_WIDTH,
  resolveLeftDockWidth,
  saveLeftDockWidth,
} from '@/shared/lib/workspace/left-dock-width';
import { MAX_LEFT_PANEL_WIDTH, MIN_LEFT_PANEL_WIDTH } from '@/shared/lib/workspace/sidebar-width';

beforeEach(() => primeKabmoSettings({}));

describe('readLeftDock', () => {
  test('nothing stored means OFF with no placed panels', () => {
    expect(readLeftDock()).toEqual({ enabled: false, panels: [] });
  });

  test('a malformed row is filtered rather than keyed', () => {
    primeKabmoSettings({
      [LEFT_DOCK_SETTING_KEY]: { enabled: true, panels: ['plugin:a:rightPanel', 3, '', null, 'plugin:a:rightPanel', 'git', 'plugin:b:rightPanel'] },
    });
    // Built-in ids and duplicates are dropped: a bare `git` names a view whose
    // floor and width slot were declared for the RIGHT column.
    expect(readLeftDock()).toEqual({
      enabled: true,
      panels: ['plugin:a:rightPanel', 'plugin:b:rightPanel'],
    });
  });

  test('the sessions view is never a placed panel', () => {
    primeKabmoSettings({ [LEFT_DOCK_SETTING_KEY]: { enabled: true, panels: [SESSIONS_VIEW_ID] } });
    expect(readLeftDock().panels).toEqual([]);
  });

  test('a non-object row reads as OFF', () => {
    primeKabmoSettings({ [LEFT_DOCK_SETTING_KEY]: 'yes' });
    expect(readLeftDock()).toEqual({ enabled: false, panels: [] });
  });
});

describe('writeLeftDock / setPanelSide', () => {
  test('the switch and the placement are independent halves', () => {
    writeLeftDock({ enabled: true });
    expect(readLeftDock()).toEqual({ enabled: true, panels: [] });
    setPanelSide('plugin:a:rightPanel', 'left');
    expect(readLeftDock()).toEqual({ enabled: true, panels: ['plugin:a:rightPanel'] });
  });

  test('placing twice is idempotent, and moving back removes it', () => {
    setPanelSide('plugin:a:rightPanel', 'left');
    setPanelSide('plugin:a:rightPanel', 'left');
    expect(readLeftDock().panels).toEqual(['plugin:a:rightPanel']);
    setPanelSide('plugin:a:rightPanel', 'right');
    expect(readLeftDock().panels).toEqual([]);
  });

  test('a built-in id and the sessions view are refused', () => {
    setPanelSide('git', 'left');
    setPanelSide(SESSIONS_VIEW_ID, 'left');
    expect(readLeftDock().panels).toEqual([]);
  });
});

describe('placing a panel turns the rail on', () => {
  test('a placement with the rail off enables it in the same state', () => {
    // The rail exists to reach the panels on it: a successful placement with
    // the rail still off is a move with no button and no view, which reads as
    // nothing having happened.
    expect(readLeftDock().enabled).toBe(false);
    setPanelSide('plugin:a:rightPanel', 'left');
    expect(readLeftDock()).toEqual({ enabled: true, panels: ['plugin:a:rightPanel'] });
  });

  test('moving a panel back to the right leaves the rail as the user set it', () => {
    // The switch is the user's, so only a PLACEMENT turns it on; a removal must
    // not turn it off behind their back.
    writeLeftDock({ enabled: true });
    setPanelSide('plugin:a:rightPanel', 'left');
    setPanelSide('plugin:a:rightPanel', 'right');
    expect(readLeftDock()).toEqual({ enabled: true, panels: [] });
  });

  test('a placement made BY HAND on a disabled dock stays off until the UI places it', () => {
    // `writeLeftDock` is the raw store; the coupling lives at the placement
    // action, so a blob written directly is not silently rewritten.
    writeLeftDock({ enabled: false, panels: ['plugin:a:rightPanel'] });
    expect(readLeftDock()).toEqual({ enabled: false, panels: ['plugin:a:rightPanel'] });
  });
});

describe('panelSideOf / leftPanelIds', () => {
  test('the sessions view is left; a placed plugin is left; everything else right', () => {
    setPanelSide('plugin:a:rightPanel', 'left');
    expect(panelSideOf(SESSIONS_VIEW_ID)).toBe('left');
    expect(panelSideOf('plugin:a:rightPanel')).toBe('left');
    expect(panelSideOf('plugin:b:rightPanel')).toBe('right');
    expect(panelSideOf('git')).toBe('right');
  });

  test('the bar order is the sessions view then the placed panels', () => {
    setPanelSide('plugin:b:rightPanel', 'left');
    setPanelSide('plugin:a:rightPanel', 'left');
    expect(leftPanelIds()).toEqual([SESSIONS_VIEW_ID, 'plugin:b:rightPanel', 'plugin:a:rightPanel']);
  });
});

describe('slot rules', () => {
  test('a view rides the rails; a takeover rides the editor column', () => {
    // The rule is the SLOT's shape, not the plugin's identity: a `rightPanel` is
    // an activity-bar view, a `panel` takes the editor column over whole.
    expect(ridesSides('rightPanel')).toEqual(['left', 'right']);
    expect(ridesSides('panel')).toEqual(['editor']);
  });

  test('a takeover cannot be placed on a rail', () => {
    // A button on a rail that opens a column somewhere else is a control that
    // lies about where it goes.
    setPanelSide('plugin:x:panel', 'left');
    expect(readLeftDock().panels).toEqual([]);
  });

  test('a view cannot be placed in the editor column', () => {
    setPanelSide('plugin:x:rightPanel', 'editor');
    // Refused, and the refusal leaves the panel where it was: the right column.
    expect(panelSideOf('plugin:x:rightPanel')).toBe('right');
  });

  test('a takeover is in the editor column by default', () => {
    expect(panelSideOf('plugin:x:panel')).toBe('editor');
  });

  test('two panels of one plugin are placed independently', () => {
    // The whole reason placement is per PANEL: moving the right panel onto the
    // left dock must not drag the plugin's editor takeover with it.
    setPanelSide('plugin:session-info:rightPanel', 'left');
    expect(panelSideOf('plugin:session-info:rightPanel')).toBe('left');
    expect(panelSideOf('plugin:session-info:panel')).toBe('editor');
  });
});

describe('isLeftDockPanelId', () => {
  test('accepts the sessions view and a plugin key only', () => {
    expect(isLeftDockPanelId(SESSIONS_VIEW_ID)).toBe(true);
    expect(isLeftDockPanelId('plugin:a:rightPanel')).toBe(true);
    expect(isLeftDockPanelId('files')).toBe(false);
    expect(isLeftDockPanelId('plugin:')).toBe(false);
  });
});

describe('left dock widths', () => {
  test('a remembered width wins and is clamped to the view floor', () => {
    saveLeftDockWidth('plugin:a:rightPanel', 400);
    expect(resolveLeftDockWidth('plugin:a:rightPanel')).toBe(400);
    saveLeftDockWidth('plugin:a:rightPanel', 10);
    expect(resolveLeftDockWidth('plugin:a:rightPanel')).toBe(MIN_LEFT_DOCK_PLUGIN_WIDTH);
    saveLeftDockWidth('plugin:a:rightPanel', 10_000);
    expect(resolveLeftDockWidth('plugin:a:rightPanel')).toBe(MAX_LEFT_PANEL_WIDTH);
  });

  test('the session list keeps its own floor, and the setting it already had', () => {
    primeKabmoSettings({ omp_sidebar_width: 333 });
    expect(resolveLeftDockWidth(SESSIONS_VIEW_ID)).toBe(333);
    saveLeftDockWidth(SESSIONS_VIEW_ID, 10);
    expect(resolveLeftDockWidth(SESSIONS_VIEW_ID)).toBe(MIN_LEFT_PANEL_WIDTH);
    // The dock's map is its own key: a plugin's width never rewrites the list's.
    saveLeftDockWidth('plugin:a:rightPanel', 500);
    expect(resolveLeftDockWidth(SESSIONS_VIEW_ID)).toBe(MIN_LEFT_PANEL_WIDTH);
    expect((readKabmoSetting<Record<string, number>>(LEFT_DOCK_WIDTHS_SETTING_KEY) ?? {})['plugin:a:rightPanel']).toBe(500);
  });
});
