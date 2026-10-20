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
  MOBILE_TOOLBAR_ALWAYS_VISIBLE,
  MOBILE_TOOLBAR_GAP_PX,
  MOBILE_TOOLBAR_ITEM_PX,
  MOBILE_TOOLBAR_PRIORITY,
  MOBILE_TOOLBAR_PRIMARY_PX,
  SIDEBAR_TOOLBAR_PRIORITY,
  TOOLBAR_ALWAYS_VISIBLE,
  TOOLBAR_CLUSTER_GAP_PX,
  TOOLBAR_GAP_PX,
  TOOLBAR_ITEM_PX,
  TOOLBAR_PRIMARY_PX,
  mobileToolbarCapacity,
  sidebarToolbarCapacity,
} from '@/shared/lib/workspace/sidebar-toolbar';

/** The row width at which `count` controls plus the `⋯` slot fit exactly. */
function rowWidthFor(count: number): number {
  return TOOLBAR_PRIMARY_PX + TOOLBAR_CLUSTER_GAP_PX + count * (TOOLBAR_ITEM_PX + TOOLBAR_GAP_PX);
}

/** The phone's row width at which `count` slots fit beside the labelled pill. */
function mobileRowWidthFor(count: number): number {
  return MOBILE_TOOLBAR_PRIMARY_PX + count * (MOBILE_TOOLBAR_ITEM_PX + MOBILE_TOOLBAR_GAP_PX);
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

/**
 * The phone's drawer row, which is where the reported bug lived.
 *
 * A 390px phone leaves 366px of row, and the pill plus six 38px controls need
 * 402 — so the row has always been over budget. It used to pay for that by
 * squeezing whichever flex item could shrink, and because the label is
 * `whitespace-nowrap` (min-content = the whole string) the shortfall landed
 * entirely on the `Plus`: measured 15px at 430, 1px at 412 and 0px at
 * 390/375/360. The row now drops a CONTROL into the `⋯` menu instead, and the
 * label's 126px is budgeted for in full.
 */
describe('mobile toolbar capacity', () => {
  test('an unmeasured row keeps every control', () => {
    // First render, and a drawer that has not been laid out: hiding controls
    // there would make the row flicker as it settles.
    expect(mobileToolbarCapacity(0)).toBe(MOBILE_TOOLBAR_PRIORITY.length);
  });

  test('the row never budgets less than the labelled pill', () => {
    // The whole bug: a pill that could not afford its own label. Every legal
    // phone width must keep the icon AND the text, so the reserve is the
    // labelled width rather than an icon-only floor.
    expect(MOBILE_TOOLBAR_PRIMARY_PX).toBeGreaterThanOrEqual(126);
  });

  test('a phone-width row moves the tail into the menu', () => {
    // 390px viewport − the drawer's 24px of padding = 366px of row.
    const capacity = mobileToolbarCapacity(366);
    expect(capacity).toBeLessThan(MOBILE_TOOLBAR_PRIORITY.length);
    // New Workspace is the head, so it is on the row; the scheduler is the
    // tail, so it is what the menu takes first.
    expect(MOBILE_TOOLBAR_PRIORITY.slice(0, capacity)).toContain('new-workspace');
    expect(MOBILE_TOOLBAR_PRIORITY.slice(capacity)).toContain('scheduler');
  });

  test('the view controls survive a Pixel 7 width', () => {
    // 412px viewport, 388px of row: archive and sort are what the phone's own
    // spec asserts are on the row, so they must outrank the two MODE controls
    // — each of which opens something and returns.
    const capacity = mobileToolbarCapacity(388);
    const onRow = MOBILE_TOOLBAR_PRIORITY.slice(0, capacity);
    expect(onRow).toContain('archive');
    expect(onRow).toContain('sort');
  });

  test('a wide drawer shows every control', () => {
    expect(mobileToolbarCapacity(mobileRowWidthFor(MOBILE_TOOLBAR_PRIORITY.length))).toBe(
      MOBILE_TOOLBAR_PRIORITY.length,
    );
    // A tablet's drawer, and the desktop-width case.
    expect(mobileToolbarCapacity(600)).toBe(MOBILE_TOOLBAR_PRIORITY.length);
  });

  test('the menu slot is counted, so the row never overflows', () => {
    // `k` slots fit; one of them is the `⋯` button, so the row draws `k − 1`
    // controls plus the menu. Without that subtraction the row overflowed by
    // exactly one control.
    //
    // Scoped to a 320px phone — the narrowest width this layout targets — and
    // up: below that the floor (the primary action is never dropped) is what
    // decides, and no rule can fit a labelled pill plus a control in it.
    for (let width = 296; width <= 600; width += 5) {
      const capacity = mobileToolbarCapacity(width);
      if (capacity >= MOBILE_TOOLBAR_PRIORITY.length) continue;
      const drawn = capacity + 1; // the controls plus the menu
      const needed = MOBILE_TOOLBAR_PRIMARY_PX + drawn * (MOBILE_TOOLBAR_ITEM_PX + MOBILE_TOOLBAR_GAP_PX);
      expect(needed).toBeLessThanOrEqual(width + MOBILE_TOOLBAR_GAP_PX);
    }
  });

  test('at least one control survives every width', () => {
    for (let width = 0; width <= 600; width += 5) {
      expect(mobileToolbarCapacity(width)).toBeGreaterThanOrEqual(MOBILE_TOOLBAR_ALWAYS_VISIBLE);
    }
  });

  test('capacity grows monotonically with the row', () => {
    let previous = 0;
    for (let width = 100; width <= 600; width += 10) {
      const capacity = mobileToolbarCapacity(width);
      expect(capacity).toBeGreaterThanOrEqual(previous);
      previous = capacity;
    }
    expect(previous).toBe(MOBILE_TOOLBAR_PRIORITY.length);
  });
});
