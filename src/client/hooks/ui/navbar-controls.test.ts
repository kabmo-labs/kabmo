/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The navbar's hide/show switch.
 *
 * The activity rails have had a right-click menu of checkboxes since they
 * existed; the navbar's own row had no such switch. The rule that matters is
 * the one the menu and the row share: an id the row can hide is an id the menu
 * lists, and a stored id this build does not know is dropped rather than kept —
 * a stale id would draw a checkbox that hides nothing.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { primeKabmoSettings } from '@/shared/lib/settings/client';
import {
  NAVBAR_CONTROLS,
  NAVBAR_HIDDEN_SETTING_KEY,
  navbarControlItems,
  navbarPluginControlId,
  readHiddenControls,
  toggleHiddenControl,
} from '@/client/hooks/ui/navbar-controls';

beforeEach(() => {
  primeKabmoSettings({});
});

describe('navbar controls', () => {
  test('a toggle adds and removes exactly one id', () => {
    expect(toggleHiddenControl([], 'reload', false)).toEqual(['reload']);
    expect(toggleHiddenControl(['reload'], 'reload', true)).toEqual([]);
    // Hiding an already-hidden control is a no-op, not a duplicate row.
    expect(toggleHiddenControl(['reload'], 'reload', false)).toEqual(['reload']);
  });

  test('the stored set keeps only ids the row can hide', () => {
    primeKabmoSettings({ [NAVBAR_HIDDEN_SETTING_KEY]: ['reload', 'gone', 42, 'reload'] });
    expect(readHiddenControls()).toEqual(['reload']);
  });

  test('every menu row names a control the row can hide', () => {
    // The menu and the row share these ids; a row with no control would be a
    // checkbox that hides nothing.
    const ids = NAVBAR_CONTROLS.map((item) => item.id);
    expect(ids).toEqual(['install', 'reload', 'context', 'signout', 'right-panel']);
    primeKabmoSettings({ [NAVBAR_HIDDEN_SETTING_KEY]: ids });
    expect(readHiddenControls()).toEqual(ids);
  });

  test('a plugin entry is `plugin:<pluginId>`, never one of its panel keys', () => {
    expect(navbarPluginControlId('stats')).toBe('plugin:stats');
    // An installed plugin's entry may be hidden before its bundle reports in,
    // so the SHAPE is what validation keeps; a panel instance key is a
    // different control and must not become a menu row.
    primeKabmoSettings({
      [NAVBAR_HIDDEN_SETTING_KEY]: ['plugin:stats', 'plugin:stats:rightPanel', 'plugin:'],
    });
    expect(readHiddenControls()).toEqual(['plugin:stats']);
  });

  test('the menu puts a plugin entry where the row draws it', () => {
    const items = navbarControlItems([{ pluginId: 'stats', title: 'Stats' }]);
    expect(items.map((item) => item.id)).toEqual([
      'install',
      'plugin:stats',
      'reload',
      'context',
      'signout',
      'right-panel',
    ]);
    expect(items[1]!.title).toBe('Stats');
  });
});
