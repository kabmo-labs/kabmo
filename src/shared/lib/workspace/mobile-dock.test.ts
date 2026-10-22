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
    expect(phoneLeftStripVisible(false)).toBe(false);
  });

  test('the rail being on IS the strip, even with nothing placed', () => {
    // The bug this pins: the rule used to require a second destination, so the
    // Settings switch "Show the left activity bar" drew nothing at all on a
    // phone with no plugin panel placed on the left — a switch whose only
    // effect was a stored boolean. On a phone the strip is the rail.
    expect(phoneLeftStripVisible(true)).toBe(true);
  });
});
