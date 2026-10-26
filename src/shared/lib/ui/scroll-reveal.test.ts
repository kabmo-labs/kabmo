/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The reveal arithmetic behind the phone's panel strip.
 *
 * Pure, because the defect it fixes is a DECISION rather than a DOM call: a
 * chip selected from outside the strip (a plugin's navbar readout) stayed past
 * the right edge of a strip with no scrollbar, so the drawer rendered the right
 * panel and named none of it. The mounted case is pinned separately in
 * `panel-chips.test.tsx`; these are the edges a stub would have to invent.
 */

import { describe, expect, test } from 'bun:test';
import { scrollLeftForReveal, type RevealGeometry } from '@/shared/lib/ui/scroll-reveal';

/** A 300px strip whose content is 900px wide, i.e. a 600px scroll range. */
function strip(overrides: Partial<RevealGeometry> = {}): RevealGeometry {
  return { scrollLeft: 0, clientWidth: 300, scrollWidth: 900, start: 0, size: 60, ...overrides };
}

describe('scrollLeftForReveal', () => {
  test('a child already in view leaves the offset alone', () => {
    // The reader scrolled to 200; a chip at 240..300 is fully visible.
    expect(scrollLeftForReveal(strip({ scrollLeft: 200, start: 240 }))).toBe(200);
  });

  test('a child past the right edge moves just enough to show it', () => {
    // 700..760 against a 300px window at 0: the offset must be 760 - 300 = 460.
    expect(scrollLeftForReveal(strip({ start: 700 }))).toBe(460);
  });

  test('a child before the left edge moves back to its own start', () => {
    expect(scrollLeftForReveal(strip({ scrollLeft: 400, start: 120 }))).toBe(120);
  });

  test('the padding is applied on whichever edge is being revealed', () => {
    expect(scrollLeftForReveal(strip({ start: 700 }), 8)).toBe(468);
    expect(scrollLeftForReveal(strip({ scrollLeft: 400, start: 120 }), 8)).toBe(112);
  });

  test('a child that exactly fills the window is already revealed', () => {
    expect(scrollLeftForReveal(strip({ scrollLeft: 100, start: 100, size: 300 }))).toBe(100);
  });

  test('the offset never passes the strip’s own scroll range', () => {
    // The LAST chip sits at 860..920; revealing it wants 620, but the range ends
    // at 600. Overshooting would leave a blank strip at the end.
    expect(scrollLeftForReveal(strip({ start: 860 }))).toBe(600);
  });

  test('the offset never goes negative', () => {
    expect(scrollLeftForReveal(strip({ scrollLeft: 0, start: 0 }), 8)).toBe(0);
  });

  test('a child wider than the window shows its leading edge', () => {
    // A 400px chip in a 300px window: both edges cannot be satisfied, and the
    // start is the half worth showing.
    expect(scrollLeftForReveal(strip({ start: 500, size: 400 }))).toBe(500);
  });

  test('a strip with nothing to scroll reports the top', () => {
    expect(scrollLeftForReveal({ scrollLeft: 0, clientWidth: 300, scrollWidth: 300, start: 40, size: 60 })).toBe(0);
  });
});
