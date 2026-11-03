/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The menu placement arithmetic, without a layout engine.
 *
 * These are the three outcomes a user can SEE: the panel hangs below the
 * trigger, flips above it near the bottom edge, and clamps inside the window's
 * left/right edges. Each was a real defect before the portal existed — the
 * sidebar's folder menu ran off the bottom of a 460px window, and the phone's
 * server sheet was written `absolute` at 340px, which runs off the right edge of
 * a 390px screen.
 */

import { describe, expect, test } from 'bun:test';
import { placeMenu, type AnchorRect } from '@/shared/lib/ui/menu-anchor';

const VIEWPORT = { width: 1200, height: 800 };

/** A trailing `⋯` at (x, y): 22px wide, 22px tall. */
function anchorAt(left: number, top: number): AnchorRect {
  return { left, right: left + 22, top, bottom: top + 22 };
}

describe('placeMenu', () => {
  test('it hangs below the trigger, right edges aligned', () => {
    const placement = placeMenu(anchorAt(200, 100), { width: 176, height: 94 }, VIEWPORT);
    // 4px gap below the trigger, and the menu's right edge on the trigger's.
    expect(placement.top).toBe(126);
    expect(placement.left).toBe(222 - 176);
  });

  test('it flips above when the space below cannot hold it', () => {
    const placement = placeMenu(anchorAt(200, 740), { width: 176, height: 94 }, VIEWPORT);
    // Above the trigger rather than past the bottom edge.
    expect(placement.top).toBe(740 - 4 - 94);
    expect(placement.top + 94).toBeLessThanOrEqual(VIEWPORT.height);
  });

  test('a menu taller than the window pins to the margin and becomes scrollable', () => {
    const placement = placeMenu(anchorAt(200, 300), { width: 176, height: 2000 }, VIEWPORT);
    expect(placement.top).toBe(8);
    expect(placement.maxHeight).toBe(VIEWPORT.height - 8 - 8);
  });

  test('a trailing menu cannot run past the right edge', () => {
    // This trigger's right edge is 32px off the window: aligned to it, the menu
    // is still inside the margin, so the clamp is what a trigger ON the edge
    // exercises.
    const placement = placeMenu(anchorAt(1150, 100), { width: 176, height: 94 }, VIEWPORT);
    expect(placement.left + 176).toBe(1172);
    expect(placement.left + 176).toBeLessThanOrEqual(VIEWPORT.width - 8);

    const onEdge = placeMenu(anchorAt(1190, 100), { width: 176, height: 94 }, VIEWPORT);
    expect(onEdge.left).toBe(VIEWPORT.width - 176 - 8);
  });

  test('a start-aligned menu cannot run past the left edge', () => {
    const placement = placeMenu(anchorAt(-40, 100), { width: 176, height: 94 }, VIEWPORT, 'start');
    expect(placement.left).toBe(8);
  });

  test('start alignment puts the menu’s left edge on the trigger’s', () => {
    const placement = placeMenu(anchorAt(500, 100), { width: 176, height: 94 }, VIEWPORT, 'start');
    expect(placement.left).toBe(500);
  });
});
