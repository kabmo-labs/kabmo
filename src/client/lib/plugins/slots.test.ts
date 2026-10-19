/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The slot store: what a plugin's bundle registered, and what happens when it
 * registers something it should not.
 *
 * Every refusal here is one that would otherwise be SILENT — a plugin whose
 * second `rightPanel` quietly replaced the first, or whose bundle exported the
 * wrong shape and therefore contributed nothing. The store is the only place
 * that can tell those apart from "the plugin is fine and has no panels", so
 * each refusal is pinned with the sentence the settings pane shows.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { definePluginApp } from '@kabmo-labs/kabmo-sdk/app';
import {
  failPluginBundle,
  headerDropdownOf,
  headerTriggerOf,
  panelOf,
  pluginSlotState,
  registerPluginBundle,
  resetPluginSlots,
  rightPanelOf,
  settingsSectionOf,
  subscribePluginSlots,
} from '@/client/lib/plugins/slots';

const Noop = () => null;

beforeEach(() => resetPluginSlots());

describe('registerPluginBundle', () => {
  test('keeps what setup registered, by plugin id', () => {
    registerPluginBundle(
      'demo',
      { default: definePluginApp((app) => app.rightPanel({ id: 'r', title: 'Right', component: Noop })) },
    );

    const slots = pluginSlotState().slots.get('demo');
    expect(slots).toBeDefined();
    expect(rightPanelOf(slots!)).toBe(Noop);
    expect(slots!.titles.rightPanel).toBe('Right');
    expect(pluginSlotState().failures).toEqual([]);
  });

  test('reads each slot through its own accessor', () => {
    registerPluginBundle(
      'demo',
      {
        default: definePluginApp((app) => {
          app.rightPanel({ id: 'r', component: Noop });
          app.panel({ id: 'p', component: Noop });
          app.headerPanel({ id: 'h', component: Noop, dropdown: { component: Noop } });
          app.settingsSection({ id: 's', component: Noop });
        }),
      },
    );

    const slots = pluginSlotState().slots.get('demo')!;
    expect(rightPanelOf(slots)).toBe(Noop);
    expect(panelOf(slots)).toBe(Noop);
    expect(headerTriggerOf(slots)).toBe(Noop);
    expect(headerDropdownOf(slots)).toBe(Noop);
    expect(settingsSectionOf(slots)).toBe(Noop);
  });

  test('a header with no dropdown has no dropdown component', () => {
    // The distinction the navbar reads: no dropdown means a static readout, so
    // the host must not wrap the trigger in a button.
    registerPluginBundle('demo', {
      default: definePluginApp((app) => app.headerPanel({ id: 'h', component: Noop })),
    });

    const slots = pluginSlotState().slots.get('demo')!;
    expect(headerTriggerOf(slots)).toBe(Noop);
    expect(headerDropdownOf(slots)).toBeUndefined();
  });

  test('refuses a second registration in the same slot, with the slot named', () => {
    registerPluginBundle('demo', {
      default: definePluginApp((app) => {
        app.rightPanel({ id: 'first', component: Noop });
        app.rightPanel({ id: 'second', component: Noop });
      }),
    });

    const failure = pluginSlotState().failures.find((entry) => entry.pluginId === 'demo');
    expect(failure?.reason).toContain('only one rightPanel');
    // The half-registered plugin is not published: a plugin that threw is not a
    // plugin that works with fewer panels.
    expect(pluginSlotState().slots.has('demo')).toBe(false);
  });

  test('refuses a registration with no component', () => {
    registerPluginBundle('demo', {
      default: definePluginApp((app) => app.panel({ id: 'p', component: undefined as never })),
    });
    expect(pluginSlotState().failures[0].reason).toContain('has no component');
  });

  test('reports a bundle whose default export is not a definition', () => {
    // The failure the whole marker field exists for: the bundle loads, registers
    // nothing, and would read as a plugin with no panels.
    registerPluginBundle('bare', { default: (app: unknown) => app });
    expect(pluginSlotState().failures[0]).toEqual({
      pluginId: 'bare',
      reason: 'the bundle has no definePluginApp(...) default export',
    });
    expect(pluginSlotState().slots.has('bare')).toBe(false);
  });

  test('a plugin that registers cleanly clears its earlier failure', () => {
    registerPluginBundle('demo', { default: {} });
    expect(pluginSlotState().failures).toHaveLength(1);

    registerPluginBundle('demo', {
      default: definePluginApp((app) => app.panel({ id: 'p', component: Noop })),
    });
    expect(pluginSlotState().failures).toEqual([]);
    expect(pluginSlotState().slots.has('demo')).toBe(true);
  });

  test('one plugin failing does not disturb another', () => {
    registerPluginBundle('good', {
      default: definePluginApp((app) => app.rightPanel({ id: 'r', component: Noop })),
    });
    registerPluginBundle('bad', { default: null });

    expect(pluginSlotState().slots.has('good')).toBe(true);
    expect(pluginSlotState().failures.map((entry) => entry.pluginId)).toEqual(['bad']);
  });
});

describe('failPluginBundle', () => {
  test('records a load failure with its reason', () => {
    failPluginBundle('demo', 'Failed to fetch dynamically imported module');
    expect(pluginSlotState().failures[0]).toEqual({
      pluginId: 'demo',
      reason: 'Failed to fetch dynamically imported module',
    });
  });

  test('replaces an earlier reason for the same plugin rather than stacking', () => {
    failPluginBundle('demo', 'first');
    failPluginBundle('demo', 'second');
    expect(pluginSlotState().failures).toEqual([{ pluginId: 'demo', reason: 'second' }]);
  });
});

describe('subscriptions', () => {
  test('notify on a write and stop after unsubscribe', () => {
    let calls = 0;
    const unsubscribe = subscribePluginSlots(() => calls++);

    failPluginBundle('demo', 'x');
    expect(calls).toBe(1);

    unsubscribe();
    failPluginBundle('demo', 'y');
    expect(calls).toBe(1);
  });

  test('reset clears both slots and failures', () => {
    registerPluginBundle('demo', {
      default: definePluginApp((app) => app.panel({ id: 'p', component: Noop })),
    });
    failPluginBundle('other', 'boom');
    resetPluginSlots();

    expect(pluginSlotState().slots.size).toBe(0);
    expect(pluginSlotState().failures).toEqual([]);
  });
});
