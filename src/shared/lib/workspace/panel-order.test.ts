/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The stored panel order: how it is read, laid over the catalog, and rewritten
 * after a drag.
 *
 * Two properties are pinned because both fail SILENTLY. A read that accepts a
 * malformed row (a duplicate, a non-string, an empty id) keys a rank map on an
 * id no panel has, and the bar draws in an order nobody chose. And a commit that
 * takes the drawn sequence verbatim DROPS every panel that was not on screen —
 * the bar cannot drag what it does not draw — so a panel switched off for a
 * moment comes back at the end of the list instead of where the user put it.
 *
 * Split from `workspace-modules.test.ts`, which is at the file-size ceiling.
 */

import { afterAll, afterEach, describe, expect, test } from 'bun:test';

import { primeChamberSettings, readChamberSetting, writeSetting } from '@/shared/lib/settings/client';
import {
  PANEL_ORDER_SETTING_KEY,
  mergeVisibleOrder,
  movePanel,
  readPanelOrder,
  savePanelOrder,
  sortPanels,
} from '@/shared/lib/workspace/panel-order';

const ORDER_KEY = PANEL_ORDER_SETTING_KEY;

/** Every case starts from "nothing stored", which is what a fresh install sees. */
function resetSettings(): void {
  primeChamberSettings({});
}

afterEach(() => {
  resetSettings();
});

afterAll(() => {
  // The settings snapshot is module state shared by every suite in one
  // `bun test` process; leave it as close to how it was found as possible.
  primeChamberSettings({});
});

describe('readPanelOrder', () => {
  test('nothing stored reads as the empty order', () => {
    resetSettings();
    expect(readPanelOrder()).toEqual([]);
    writeSetting(ORDER_KEY, 'not-a-list');
    expect(readPanelOrder()).toEqual([]);
  });

  test('a malformed row is filtered rather than keyed', () => {
    resetSettings();
    writeSetting(ORDER_KEY, ['git', 3, '', null, 'git', 'files']);
    // The duplicate is dropped, not kept: a second rank for one id would make
    // the comparison depend on which entry the sort happened to read.
    expect(readPanelOrder()).toEqual(['git', 'files']);
  });
});

describe('sortPanels', () => {
  const panels = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  test('an empty order leaves the catalog as it was', () => {
    expect(sortPanels(panels, []).map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  test('named panels are ordered and unnamed ones are appended in place', () => {
    // `c` is not named — a plugin installed after the order was written — so it
    // keeps its catalog position at the END rather than being dropped.
    expect(sortPanels(panels, ['b']).map((p) => p.id)).toEqual(['b', 'a', 'c']);
  });

  test('an id the catalog does not hold is ignored, not invented', () => {
    expect(sortPanels(panels, ['gone', 'c', 'a']).map((p) => p.id)).toEqual(['c', 'a', 'b']);
  });

  test('a full order is honoured exactly', () => {
    expect(sortPanels(panels, ['c', 'a', 'b']).map((p) => p.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('movePanel', () => {
  const ids = ['a', 'b', 'c', 'd'];

  test('dragging down lands the row where it was dropped', () => {
    expect(movePanel(ids, 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
  });

  test('dragging up lands it above the row it was dropped on', () => {
    expect(movePanel(ids, 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
  });

  test('an absent id or a no-op move returns a copy, not a mutation', () => {
    const next = movePanel(ids, 'a', 'a');
    expect(next).toEqual(ids);
    expect(next).not.toBe(ids);
    expect(movePanel(ids, 'nope', 'a')).toEqual(ids);
  });
});

describe('mergeVisibleOrder', () => {
  test('a reorder of the visible rows keeps the hidden ids in their slots', () => {
    // `hidden` is switched off, so the bar drew [a, b, c] and the user moved c
    // to the front. The hidden id keeps its position BETWEEN them.
    const stored = ['a', 'hidden', 'b', 'c'];
    expect(mergeVisibleOrder(stored, ['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual(['c', 'hidden', 'a', 'b']);
  });

  test('a visible id the stored order never named is appended', () => {
    // A plugin installed after the order was written: it has no slot to fill,
    // so the reorder appends it rather than losing it.
    expect(mergeVisibleOrder(['a', 'b'], ['a', 'b', 'new'], ['new', 'b', 'a'])).toEqual(['new', 'b', 'a']);
  });

  test('an empty stored order is exactly the drawn order', () => {
    expect(mergeVisibleOrder([], ['a', 'b'], ['b', 'a'])).toEqual(['b', 'a']);
  });
});

describe('savePanelOrder', () => {
  test('a save round-trips through the settings snapshot', () => {
    resetSettings();
    savePanelOrder(['plan', 'git']);
    expect(readChamberSetting<string[]>(ORDER_KEY)).toEqual(['plan', 'git']);
    expect(readPanelOrder()).toEqual(['plan', 'git']);
  });
});
