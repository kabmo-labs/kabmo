/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The desktop toolbar's overflow boundary.
 *
 * The row holds a primary button plus seven icon controls in 264–500px of
 * sidebar. At the narrow end that does not fit, and the answer is a `⋯` menu
 * rather than a row that overflows (a horizontal scroll hides controls with
 * nothing on screen to say so) or a label squeezed to two pixels (the previous
 * behaviour, measured in the browser). These cases pin where the boundary sits
 * and that the priority order — not the display order — decides what goes.
 */

import { describe, expect, test } from 'bun:test';
import {
  SIDEBAR_TOOLBAR_PRIORITY,
  TOOLBAR_ALWAYS_VISIBLE,
  TOOLBAR_CLUSTER_GAP_PX,
  TOOLBAR_GAP_PX,
  TOOLBAR_ITEM_PX,
  TOOLBAR_PRIMARY_PX,
  sidebarToolbarCapacity,
} from '@/shared/lib/workspace/sidebar-toolbar';

/** The row width at which `count` controls plus the `⋯` slot fit exactly. */
function rowWidthFor(count: number): number {
  return TOOLBAR_PRIMARY_PX + TOOLBAR_CLUSTER_GAP_PX + count * (TOOLBAR_ITEM_PX + TOOLBAR_GAP_PX);
}

describe('sidebar toolbar capacity', () => {
  test('an unmeasured row keeps every control', () => {
    // A collapsed sidebar and the first render both report 0; hiding controls
    // there would make the toolbar flicker as the layout settles.
    expect(sidebarToolbarCapacity(0)).toBe(SIDEBAR_TOOLBAR_PRIORITY.length);
  });

  test('a wide sidebar shows every control', () => {
    expect(sidebarToolbarCapacity(rowWidthFor(SIDEBAR_TOOLBAR_PRIORITY.length))).toBe(SIDEBAR_TOOLBAR_PRIORITY.length);
    expect(sidebarToolbarCapacity(476)).toBe(SIDEBAR_TOOLBAR_PRIORITY.length);
  });

  test('the narrowest legal sidebar moves only the tail into the menu', () => {
    // 240px of row content at the 264px minimum: the primary button, the two
    // controls that must never leave, and the `⋯` slot.
    const capacity = sidebarToolbarCapacity(240);
    expect(capacity).toBe(TOOLBAR_ALWAYS_VISIBLE);
    expect(capacity).toBeLessThan(SIDEBAR_TOOLBAR_PRIORITY.length);
  });

  test('the always-visible pair survives every legal width', () => {
    // New Workspace (beside New Session, the phone's order) and Refresh are
    // floored, so no drag can push them into the `⋯` menu.
    for (let width = 100; width <= 500; width += 10) {
      expect(sidebarToolbarCapacity(width)).toBeGreaterThanOrEqual(TOOLBAR_ALWAYS_VISIBLE);
    }
    expect(SIDEBAR_TOOLBAR_PRIORITY.slice(0, TOOLBAR_ALWAYS_VISIBLE)).toEqual(['new-workspace', 'refresh']);
  });

  test('capacity grows monotonically with the row', () => {
    let previous = 0;
    for (let width = 100; width <= 500; width += 10) {
      const capacity = sidebarToolbarCapacity(width);
      expect(capacity).toBeGreaterThanOrEqual(previous);
      previous = capacity;
    }
    expect(previous).toBe(SIDEBAR_TOOLBAR_PRIORITY.length);
  });

  test('collapsing the sidebar is not a toolbar control', () => {
    // It lives in the title bar, where the phone puts its own close button —
    // so it can never be pushed into the menu.
    expect(SIDEBAR_TOOLBAR_PRIORITY as string[]).not.toContain('close');
  });
});
