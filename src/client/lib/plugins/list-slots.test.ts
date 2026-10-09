/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The LIST-slot store: every plugin's rows for one slot, merged.
 *
 * The store's read is a MERGE, which is what makes it different from the
 * positional store (`slots.ts`): the order is load-bearing (a chat row's action
 * strip renders it), a duplicate key is refused rather than replacing, and a
 * disposer takes back exactly one row. Each of those is pinned here because each
 * would otherwise fail silently — a replaced row, a row that will not go away, a
 * strip whose order changed between reloads.
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import {
  clearPluginListSlots,
  listSlotRows,
  registerListSlot,
  resetListSlots,
  subscribeListSlots,
} from '@/client/lib/plugins/list-slots';

const Noop = () => null;
const row = (id: string, order?: number) => ({
  id,
  component: Noop,
  ...(order === undefined ? {} : { order }),
});

beforeEach(() => resetListSlots());

describe('registerListSlot', () => {
  test('reads back the row with the plugin it came from', () => {
    registerListSlot('demo', 'messageAction', row('copy'));

    const rows = listSlotRows('messageAction');
    expect(rows).toHaveLength(1);
    expect(rows[0].pluginId).toBe('demo');
    expect(rows[0].slot).toBe('messageAction');
    expect(rows[0].registration.id).toBe('copy');
  });

  test('two plugins both contributing a messageAction both appear', () => {
    registerListSlot('alpha', 'messageAction', row('copy'));
    registerListSlot('beta', 'messageAction', row('quote'));

    expect(listSlotRows('messageAction').map((entry) => `${entry.pluginId}:${entry.registration.id}`)).toEqual([
      'alpha:copy',
      'beta:quote',
    ]);
  });

  test('sorts by order first, then plugin id, then row id', () => {
    registerListSlot('beta', 'messageAction', row('z'));
    registerListSlot('alpha', 'messageAction', row('m', 5));
    registerListSlot('alpha', 'messageAction', row('a'));
    registerListSlot('beta', 'messageAction', row('a', 5));

    // order 0 rows (alpha:a, beta:z) before order 5 rows (alpha:m, beta:a), and
    // within an order band the plugin id then the row id break the tie — so the
    // strip is stable across reloads instead of following import timing.
    expect(listSlotRows('messageAction').map((entry) => `${entry.pluginId}:${entry.registration.id}`)).toEqual([
      'alpha:a',
      'beta:z',
      'alpha:m',
      'beta:a',
    ]);
  });

  test('refuses a duplicate id within one plugin and slot, naming both', () => {
    registerListSlot('demo', 'messageAction', row('copy'));
    expect(() => registerListSlot('demo', 'messageAction', row('copy'))).toThrow(
      'messageAction "copy" is already registered by this plugin',
    );
  });

  test('keys a row per slot, so the same id in another slot is not a duplicate', () => {
    registerListSlot('demo', 'messageAction', row('shared'));
    expect(() => registerListSlot('demo', 'composerAction', row('shared'))).not.toThrow();
    expect(listSlotRows('composerAction')).toHaveLength(1);
  });

  test('refuses a row with no id', () => {
    expect(() => registerListSlot('demo', 'messageAction', { id: '', component: Noop })).toThrow(
      'messageAction registration needs a non-empty id',
    );
  });

  test('a disposer removes exactly one row, and only once', () => {
    const disposeFirst = registerListSlot('demo', 'messageAction', row('first'));
    registerListSlot('demo', 'messageAction', row('second'));
    registerListSlot('other', 'messageAction', row('third'));

    disposeFirst();
    expect(listSlotRows('messageAction').map((entry) => entry.registration.id)).toEqual(['second', 'third']);

    disposeFirst();
    expect(listSlotRows('messageAction').map((entry) => entry.registration.id)).toEqual(['second', 'third']);
  });

  test('only the changed slot is returned by a read', () => {
    registerListSlot('demo', 'fileOpener', { id: 'img', matches: () => true, component: Noop });
    expect(listSlotRows('messageAction')).toEqual([]);
    expect(listSlotRows('fileOpener')).toHaveLength(1);
  });
});

describe('subscribeListSlots', () => {
  test('fires on registration and on disposal', () => {
    let calls = 0;
    const unsubscribe = subscribeListSlots(() => calls++);

    const dispose = registerListSlot('demo', 'messageAction', row('copy'));
    expect(calls).toBe(1);
    dispose();
    expect(calls).toBe(2);
    // A disposer whose row is already gone publishes nothing.
    dispose();
    expect(calls).toBe(2);

    unsubscribe();
    registerListSlot('demo', 'messageAction', row('quiet'));
    expect(calls).toBe(2);
  });
});

describe('clearPluginListSlots', () => {
  test("drops one plugin's rows and leaves every other plugin's", () => {
    registerListSlot('demo', 'messageAction', row('copy'));
    registerListSlot('demo', 'composerAction', row('send'));
    registerListSlot('other', 'messageAction', row('keep'));

    clearPluginListSlots('demo');

    expect(listSlotRows('messageAction').map((entry) => entry.pluginId)).toEqual(['other']);
    expect(listSlotRows('composerAction')).toEqual([]);
  });

  test('is a no-op when the plugin contributed nothing', () => {
    let calls = 0;
    subscribeListSlots(() => calls++);
    clearPluginListSlots('absent');
    expect(calls).toBe(0);
  });
});
