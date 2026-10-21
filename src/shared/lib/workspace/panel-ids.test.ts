/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Panel id guards: what a stored `layout.activeRightPanel` and a width-map key
 * are allowed to be.
 *
 * These predicates are the only thing standing between a persisted blob and a
 * layout that renders a view nobody asked for, so the interesting cases are the
 * near-misses: a bare prefix, a stray segment, a non-string.
 */

import { test, expect, describe } from 'bun:test';
import {
  isPanelId,
  migrateLegacyPanelId,
  pluginEnablementKey,
  pluginIdOf,
  pluginKeyOf,
  pluginPanelKey,
  pluginSlotOf,
} from '@/shared/lib/workspace/panel-ids';

describe('pluginPanelKey', () => {
  test('names ONE panel: the plugin id AND the slot', () => {
    expect(pluginPanelKey('hello', 'rightPanel')).toBe('plugin:hello:rightPanel');
    expect(pluginPanelKey('hello', 'panel')).toBe('plugin:hello:panel');
    // Two panels of one plugin are two keys, which is what lets a placement and
    // a width follow one of them without dragging the other along.
    expect(pluginPanelKey('hello', 'panel')).not.toBe(pluginPanelKey('hello', 'rightPanel'));
  });
});

describe('pluginEnablementKey', () => {
  test('names the PLUGIN, whatever it contributes', () => {
    // Enablement is per plugin: the switch says "Disable <plugin>" and the
    // server gates that plugin's bundle on this key, so one switch is one id.
    expect(pluginEnablementKey('hello')).toBe('plugin:hello');
  });
});

describe('pluginKeyOf', () => {
  test('accepts both forms, normalizing the retired one to rightPanel', () => {
    expect(pluginKeyOf('plugin:hello:rightPanel')).toBe('plugin:hello:rightPanel');
    expect(pluginKeyOf('plugin:hello:panel')).toBe('plugin:hello:panel');
    // The form that shipped, before the slot segment: the only reachable slot
    // then was the right panel, so that is where such a row still points.
    expect(pluginKeyOf('plugin:hello')).toBe('plugin:hello:rightPanel');
  });

  test('rejects a bare prefix, a slash, a third segment and an unknown slot', () => {
    expect(pluginKeyOf('plugin:')).toBeNull();
    expect(pluginKeyOf('plugin:hello/greeter')).toBeNull();
    expect(pluginKeyOf('plugin:a:b:c')).toBeNull();
    expect(pluginKeyOf('plugin:hello:headerPanel')).toBeNull();
  });

  test('rejects a built-in view id and a non-string', () => {
    expect(pluginKeyOf('files')).toBeNull();
    expect(pluginKeyOf(7)).toBeNull();
    expect(pluginKeyOf(null)).toBeNull();
  });
});

describe('migrateLegacyPanelId', () => {
  test('reports the retired form and what it becomes', () => {
    expect(migrateLegacyPanelId('plugin:hello')).toEqual({
      from: 'plugin:hello',
      to: 'plugin:hello:rightPanel',
    });
  });

  test('says nothing for a value that is already current or not a panel id', () => {
    expect(migrateLegacyPanelId('plugin:hello:panel')).toBeNull();
    expect(migrateLegacyPanelId('files')).toBeNull();
    expect(migrateLegacyPanelId(null)).toBeNull();
  });
});

describe('pluginSlotOf', () => {
  test('names the slot, so a placement can be per panel', () => {
    expect(pluginSlotOf('plugin:hello:panel')).toBe('panel');
    expect(pluginSlotOf('plugin:hello')).toBe('rightPanel');
    expect(pluginSlotOf('files')).toBeNull();
  });
});

describe('pluginIdOf', () => {
  test('unwraps the plugin id, from either form', () => {
    expect(pluginIdOf('plugin:hello')).toBe('hello');
    expect(pluginIdOf('plugin:hello:panel')).toBe('hello');
    expect(pluginIdOf('files')).toBeNull();
  });
});

describe('isPanelId', () => {
  test('accepts every built-in view', () => {
    expect(isPanelId('files')).toBe(true);
    expect(isPanelId('wiki')).toBe(true);
    expect(isPanelId('plan')).toBe(true);
  });

  test('accepts a plugin panel key, in both forms', () => {
    expect(isPanelId('plugin:hello')).toBe(true);
    expect(isPanelId('plugin:hello:panel')).toBe(true);
  });

  test('rejects an unknown view and a malformed plugin key', () => {
    expect(isPanelId('nope')).toBe(false);
    expect(isPanelId('plugin:')).toBe(false);
    expect(isPanelId(undefined)).toBe(false);
  });
});
