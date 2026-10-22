/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Which phone drawer can reach a panel, and when none can.
 *
 * Three answers and each is a silent failure when wrong:
 *
 * - a panel placed on the left with the rail ON belongs to the LEFT drawer —
 *   the right drawer's catalog deliberately drops it (`phoneRightPanels`), so
 *   sending the user there would open a drawer that does not list it;
 * - the same panel with the rail OFF belongs to the RIGHT drawer, which is the
 *   rule that keeps a placement reachable when the left drawer has no strip;
 * - an `editor`-slot takeover belongs to NEITHER, because a phone has no editor
 *   column — the caller must do nothing rather than navigate to a blank screen.
 *
 * A built-in view is always `right`, so it never lands on the left drawer even
 * though its id is not a plugin key.
 */

import { describe, expect, test } from 'bun:test';
import { phoneDrawerForPanel } from '@/shared/lib/workspace/panel-open';
import type { LeftDockState } from '@/shared/lib/workspace/left-dock';

const RAIL_ON: LeftDockState = { enabled: true, panels: ['plugin:stats:rightPanel'] };
const RAIL_OFF: LeftDockState = { enabled: false, panels: ['plugin:stats:rightPanel'] };

describe('phoneDrawerForPanel', () => {
  test('a panel placed on the left, with the rail on, is the left drawer', () => {
    expect(phoneDrawerForPanel('plugin:stats:rightPanel', RAIL_ON)).toBe('left');
  });

  test('the same placement with the rail off is the right drawer', () => {
    // The left drawer draws no chip strip while the rail is off, so the panel
    // stays in the right drawer's `all` catalog — and that is where the click
    // has to land.
    expect(phoneDrawerForPanel('plugin:stats:rightPanel', RAIL_OFF)).toBe('right');
  });

  test('an unplaced panel is the right drawer', () => {
    expect(phoneDrawerForPanel('plugin:stats:rightPanel', { enabled: true, panels: [] })).toBe('right');
  });

  test('a built-in view is the right drawer, never the left one', () => {
    expect(phoneDrawerForPanel('git', RAIL_ON)).toBe('right');
    expect(phoneDrawerForPanel('files', RAIL_OFF)).toBe('right');
  });

  test('an editor-slot takeover has no drawer at all', () => {
    // A phone has no editor column. Reporting a drawer would navigate to a
    // screen whose catalog cannot show the panel.
    expect(phoneDrawerForPanel('plugin:session-info:panel', RAIL_ON)).toBeNull();
  });
});
