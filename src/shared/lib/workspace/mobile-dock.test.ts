/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Which panels each phone drawer offers.
 *
 * Both rules are silent failures when wrong, which is why they are pinned:
 * a panel on BOTH strips is one panel with two chips (and one of them is a
 * second place to be), while a panel on NEITHER is a placement that looks like
 * an uninstall.
 */

import { describe, expect, test } from 'bun:test';
import { phoneLeftStripVisible, phoneRightPanels } from '@/shared/lib/workspace/mobile-dock';
import type { PanelSide } from '@/shared/lib/workspace/left-dock';

const SESSIONS = 'sessions';

function panels(...rows: [string, PanelSide][]) {
  return rows.map(([id, side]) => ({ id, side }));
}

describe('phoneRightPanels', () => {
  test('drops the session list, which the phone draws as its own screen', () => {
    const all = panels([SESSIONS, 'left'], ['files', 'right']);
    expect(phoneRightPanels(all, SESSIONS, false).map((p) => p.id)).toEqual(['files']);
  });

  test('with the rail OFF a left-placed panel stays here — the left drawer cannot reach it', () => {
    const all = panels([SESSIONS, 'left'], ['files', 'right'], ['plugin:demo:rightPanel', 'left']);
    expect(phoneRightPanels(all, SESSIONS, false).map((p) => p.id)).toEqual(['files', 'plugin:demo:rightPanel']);
  });

  test('with the rail ON the left drawer owns it, so this one must not draw it twice', () => {
    const all = panels([SESSIONS, 'left'], ['files', 'right'], ['plugin:demo:rightPanel', 'left']);
    expect(phoneRightPanels(all, SESSIONS, true).map((p) => p.id)).toEqual(['files']);
  });

  test('the rail being on never hides a RIGHT-column view', () => {
    const all = panels(['git', 'right'], ['todo', 'right']);
    expect(phoneRightPanels(all, SESSIONS, true).map((p) => p.id)).toEqual(['git', 'todo']);
  });
});

describe('phoneLeftStripVisible', () => {
  test('no rail, no strip', () => {
    expect(phoneLeftStripVisible(false, 2, true)).toBe(false);
  });

  test('a strip holding only Sessions is chrome that never changes', () => {
    expect(phoneLeftStripVisible(true, 0, true)).toBe(false);
  });

  test('a placed panel is a second destination, so the strip appears', () => {
    expect(phoneLeftStripVisible(true, 1, true)).toBe(true);
  });

  test('a stored view that no longer resolves still gets the strip — its body is a notice', () => {
    // Without this the drawer would be stuck on a notice with no way back to
    // the session list: the body has no chips of its own.
    expect(phoneLeftStripVisible(true, 0, false)).toBe(true);
  });
});
